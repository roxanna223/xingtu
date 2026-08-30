// 调试面板 API（仅开发环境开放；生产需 DEBUG_ENABLED=1 且当前用户为 admin）
// GET  : 调试状态（环境/时钟/缓存/数据概况/用户列表）
// POST : 调试操作（setClock / clearCache / loginAs / runOvernight / consumeChats / resetProfile）

import { getDB } from '@/lib/db'
import {
  findUserById,
  listUsers,
  readProfile,
  writeProfile,
  readDays,
  readChats,
  readPersonaDocs,
  withStoreLock,
} from '@/lib/store'
import { pendingChatCount, consumePendingChats } from '@/lib/chatStore'
import { runOvernightAll, runOvernightForUser, yesterdayKey } from '@/lib/overnight'
import {
  requireAuth,
  assertSameOrigin,
  readJsonBody,
  createSessionToken,
  serializeSessionCookie,
  reqIsHttps,
} from '@/lib/auth'
import { setClockOffsetDays, getClockOffsetDays, fakeNow, fakeTodayISO } from '@/lib/clock'
import { todayKey } from '@/lib/day'
import { trackReq } from '@/lib/track'

/** 调试功能可用性：dev 环境全体登录用户；生产环境需 DEBUG_ENABLED=1 且为 admin */
export function debugAllowed(user) {
  if (process.env.NODE_ENV === 'development') return true
  return process.env.DEBUG_ENABLED === '1' && user?.role === 'admin'
}

function clockSnapshot() {
  const f = fakeNow()
  return {
    offsetDays: getClockOffsetDays(),
    fakeNow: f.toISOString(),
    localNow: f.toString(),
    fakeTodayISO: fakeTodayISO(),
    todayKey: todayKey(),
    yesterdayKey: yesterdayKey(),
  }
}

export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  const allowed = debugAllowed(auth.user)

  if (!allowed) {
    return Response.json({ available: false, reason: '调试功能未启用（dev 环境自动开放；生产需 DEBUG_ENABLED=1 且为管理员）' })
  }

  const p = readProfile(userId)
  const chats = readChats(userId)
  const docs = readPersonaDocs(userId)
  return Response.json({
    available: true,
    env: {
      nodeEnv: process.env.NODE_ENV,
      debugEnabled: process.env.DEBUG_ENABLED === '1',
      hasKey: !!process.env.DEEPSEEK_API_KEY,
      mockEngine: !process.env.DEEPSEEK_API_KEY,
      hasMoonshotKey: !!process.env.MOONSHOT_API_KEY,
    },
    clock: clockSnapshot(),
    me: { id: userId, username: auth.user.username, role: auth.user.role },
    users: listUsers(),
    data: {
      dayCount: readDays(userId).length,
      topicCount: (p.topics || []).length,
      goalCount: (p.goals || []).length,
      activeGoalCount: (p.goals || []).filter((g) => g.status === 'active').length,
      testCount: (p.tests || []).length,
      adoptionCount: (p.adoptions || []).length,
      feedbackCount: (p.feedbackLog || []).length,
      emotionSeriesCount: (p.emotionSeries || []).length,
      chatSessionCount: chats.length,
      pendingChats: pendingChatCount(chats),
      generating: !!p.generating,
      crisisFlag: !!p.crisisFlag,
      personaDocs: {
        self: (docs?.self || '').length,
        persona: (docs?.persona || '').length,
        working: (docs?.working || '').length,
      },
      personaInstincts: (p.personaMeta || []).length,
      cache: {
        latestReport: !!p.lastReport?.generatedAt,
        latestDayKey: p.lastReport?.dayKey || null,
        historyReports: Object.keys(p.reports || {}).length,
        periodReports: Object.keys(p.periodReports || {}).length,
      },
    },
  })
}

export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  if (!debugAllowed(auth.user)) return Response.json({ error: '调试功能未启用' }, { status: 403 })
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const userId = auth.user.id
  const action = body.action || ''
  trackReq(req, 'debug_action', '/api/debug', { action })

  /* ---------- 时钟：调整"今天"（服务端所有日期计算生效） ---------- */
  if (action === 'setClock') {
    const days = Number(body.offsetDays)
    if (!Number.isFinite(days)) return Response.json({ error: 'offsetDays 必须是数字' }, { status: 400 })
    setClockOffsetDays(days)
    return Response.json({ ok: true, clock: clockSnapshot() })
  }

  /* ---------- 报告缓存：清 latest / history / period / all ---------- */
  if (action === 'clearCache') {
    const scope = body.scope || 'all'
    if (!['latest', 'history', 'period', 'all'].includes(scope)) {
      return Response.json({ error: 'scope 必须是 latest/history/period/all' }, { status: 400 })
    }
    await withStoreLock(async () => {
      const p = readProfile(userId)
      if (scope === 'latest' || scope === 'all') p.lastReport = null
      if (scope === 'history' || scope === 'all') p.reports = {}
      if (scope === 'period' || scope === 'all') p.periodReports = {}
      writeProfile(userId, p)
    })
    const p2 = readProfile(userId)
    return Response.json({
      ok: true,
      cache: {
        latestReport: !!p2.lastReport?.generatedAt,
        historyReports: Object.keys(p2.reports || {}).length,
        periodReports: Object.keys(p2.periodReports || {}).length,
      },
    })
  }

  /* ---------- 切换用户：以任意用户身份登录（写会话 cookie） ---------- */
  if (action === 'loginAs') {
    const targetId = Number(body.userId)
    const target = findUserById(targetId)
    if (!target) return Response.json({ error: '目标用户不存在' }, { status: 404 })
    const token = createSessionToken(target.username)
    const secure = reqIsHttps(req)
    return new Response(JSON.stringify({ ok: true, username: target.username }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': serializeSessionCookie(token, secure),
      },
    })
  }

  /* ---------- 6:00 夜间作业：单用户 / 全体 ---------- */
  if (action === 'runOvernight') {
    const day = body.day ? String(body.day).slice(0, 10) : yesterdayKey()
    const force = body.force === true
    const out = await runOvernightForUser(userId, day, { force })
    return Response.json({ ok: true, ...out })
  }
  if (action === 'runOvernightAll') {
    const day = body.day ? String(body.day).slice(0, 10) : yesterdayKey()
    const force = body.force === true
    const out = await runOvernightAll({ targetDay: day, force })
    return Response.json({ ok: true, ...out })
  }

  /* ---------- 待抽取对话：立即并入画像 ---------- */
  if (action === 'consumeChats') {
    const out = await consumePendingChats(userId)
    return Response.json({ ok: true, ...out })
  }

  /* ---------- 重置当前账号画像（危险操作，清空画像与全部业务数据） ---------- */
  if (action === 'resetProfile') {
    const d = getDB()
    await withStoreLock(async () => {
      for (const table of ['days', 'chats', 'journals', 'stream', 'persona', 'jobs']) {
        d.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId)
      }
      const u = findUserById(userId)
      writeProfile(userId, {
        user: {
          username: u?.username || '',
          cohort: u?.cohort || null,
          careerStage: u?.careerStage || '',
          personaTier: u?.personaTier || 'logical',
          starSign: u?.starSign || null,
          starSymbol: u?.starSymbol || null,
          birthDate: u?.birthDate || null,
        },
      })
    })
    return Response.json({ ok: true, note: '画像与业务数据已清空（账号/密码保留），头像回到第一天' })
  }

  return Response.json({ error: `未知 action：${action}` }, { status: 400 })
}
