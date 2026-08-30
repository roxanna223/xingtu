// 6:00 夜间作业（docs/23 §4.4 / docs/24 §3）：日报定时预生成 + 进化反思（Letta sleep-time compute 思想）
//
// - 目标日：刚刚关闭的一天（6:00 划日下，6:00 之后 yesterdayKey = 昨天）
// - 幂等：jobs 表 UNIQUE(user_id, day, kind)，进程重启/并发调度都不会重复执行
// - 触发：① instrumentation.js 每 60 秒检查，命中 06:00~06:15 窗口自动跑；
//         ② /api/admin/run-overnight（管理员手动触发，便于验证与补跑）
// - Mock 模式（无 API Key）：跳过 LLM 报告生成，仅做规则层收尾（decay + persona 文档重建）

import {
  readProfile, writeProfile, readDays, readStream, listUserIds, jobDone, markJob, withStoreLock,
} from './store.js'
import { generateReport } from './engine.js'
import { detectIntent, patternTopics } from './intent.js'
import { consumePendingChats } from './chatStore.js'
import { rebuildPersonaDocs, decayMeta } from './evolution.js'
import { formatStream } from './stream.js'
import { todayKey, parseKey, fmtDate } from './day.js'
import { fakeNow } from './clock.js'

export const OVERNIGHT_KIND = 'overnight'

/** 昨天（6:00 划日）的 key */
export function yesterdayKey(nowKey = todayKey()) {
  const d = parseKey(nowKey)
  d.setDate(d.getDate() - 1)
  return fmtDate(d)
}

/** 单用户夜间作业：预生成昨日日报 + 进化收尾（decay 落地 + persona 三文档重建） */
export async function runOvernightForUser(userId, targetDay, { force = false } = {}) {
  if (jobDone(userId, targetDay, OVERNIGHT_KIND) && !force) {
    return { userId, targetDay, skipped: true }
  }
  await withStoreLock(async () => {
    // ① 把昨天剩余的未抽取对话并入画像（确定性，与既有管线一致）
    await consumePendingChats(userId)

    let p = readProfile(userId)
    // ② 进化收尾：时间衰减落地（把只读时惰性算的 decay 写回持久层）
    p.personaMeta = decayMeta(p.personaMeta || [])

    const streamText = formatStream(readStream(userId, targetDay))
    const dayRecord = readDays(userId).find((d) => d.date === targetDay)

    if ((streamText || dayRecord) && process.env.DEEPSEEK_API_KEY) {
      // ③ 昨日日报预生成（幂等：已有缓存则跳过 LLM）
      const already = p.reports?.[targetDay]
      if (force || !already || !already.generatedAt) {
        const track = dayRecord?.q2 || ''
        const intent = detectIntent(`${dayRecord?.freeText || ''} ${dayRecord?.q1 || ''} ${dayRecord?.q3 || ''} ${streamText}`)
        const patterns = patternTopics(p)
        const rep = await generateReport(p, null, track, dayRecord || null, intent, patterns, streamText)
        const fresh = readProfile(userId)
        rep.dayKey = targetDay
        fresh.lastReport = rep
        fresh.reports = fresh.reports || {}
        fresh.reports[targetDay] = { ...rep, trackText: track }
        p = fresh
      }
    }

    // ④ 个人资产三文档重建（self/persona/working，确定性）
    rebuildPersonaDocs(userId, p)
    writeProfile(userId, p)
    markJob(userId, targetDay, OVERNIGHT_KIND)
  })
  return { userId, targetDay, skipped: false }
}

/** 全部用户的夜间作业（顺序执行；单用户失败不阻塞其余） */
export async function runOvernightAll({ force = false, targetDay = null } = {}) {
  const day = targetDay || yesterdayKey()
  const ids = listUserIds()
  const results = []
  for (const userId of ids) {
    try {
      results.push(await runOvernightForUser(userId, day, { force }))
    } catch (e) {
      console.warn(`[overnight] 用户 ${userId} 夜间作业失败：`, e.message)
      results.push({ userId, targetDay: day, error: e.message })
    }
  }
  return { targetDay: day, results }
}

/** 是否处于 6:00 窗口（06:00~06:15），供调度器使用 */
export function inMorningWindow(now = fakeNow()) {
  const h = now.getHours()
  const m = now.getMinutes()
  return h === 6 && m < 15
}
