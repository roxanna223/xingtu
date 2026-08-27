import { readProfile, writeProfile, readChats, withStoreLock } from '@/lib/store'
import { callLLM, parseJson, mockStar, mockSuggestions, buildProfileSummary, generateGoalBreak } from '@/lib/engine'
import { starMessages, suggestionsMessages } from '@/lib/prompts'
import { routeSkill, recordSkillLog } from '@/lib/skills'
import { createGoalFromSkill, syncGoalsWithText } from '@/lib/goals'
import { updateBehavior } from '@/lib/behavior'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'
import {
  saveSession,
  getSession,
  newSession,
  findRestorable,
  appendMessage,
  isControlMessage,
} from '@/lib/chatStore'

/** 对话内容异步同步目标进度（不阻塞回复；写锁内重读画像，避免并发覆盖） */
async function syncGoalsInBackground(userId, text) {
  try {
    await withStoreLock(async () => {
      const p = readProfile(userId)
      if (!(p.goals || []).some((g) => g.status === 'active')) return
      const { updates } = await syncGoalsWithText(p, text, 'chat')
      if (updates.length) writeProfile(userId, p)
    })
  } catch (e) {
    console.warn('[goals] 对话目标同步失败：', e.message)
  }
}

export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { message = '', quiz = null, mode = 'chat', sessionId = null } = body
  const text = String(message || '').trim().slice(0, 2000)
  if (text) trackReq(req, 'chat_message', '/api/star')

  const p = readProfile(userId)
  const summary = buildProfileSummary(p)

  // 快速开始提示生成（不落盘对话，但 Skill 调度留痕）
  if (mode === 'suggestions') {
    let suggestions = null
    if (!process.env.DEEPSEEK_API_KEY) {
      suggestions = mockSuggestions(summary).suggestions
    } else {
      try {
        const raw = await callLLM(suggestionsMessages(summary))
        const parsed = parseJson(raw)
        if (parsed && Array.isArray(parsed.suggestions) && parsed.suggestions.length) {
          suggestions = parsed.suggestions.slice(0, 3)
        }
      } catch (e) {
        console.warn('[star] suggestions 失败：', e.message)
      }
    }
    if (!suggestions) suggestions = mockSuggestions(summary).suggestions
    const fresh = readProfile(userId)
    recordSkillLog(fresh, { skillId: 'quickStart', source: 'rule', outcome: 'completed', detail: `生成 ${suggestions.length} 条` })
    writeProfile(userId, fresh)
    return Response.json({ suggestions })
  }

  // 页面加载恢复：找回最近一次未结束的小星对话（刷新不再丢失）
  if (mode === 'restore') {
    const s = findRestorable(readChats(userId), 'star')
    if (s) return Response.json({ history: s.messages, sessionId: s.id })
    return Response.json({ history: null, sessionId: null })
  }

  /* ---------- 对话 / 测验 / 技能 ---------- */
  let chats = readChats(userId)
  let session = sessionId ? getSession(chats, sessionId) : null

  if (text) {
    if (!session) {
      session = newSession('star')
      chats = saveSession(userId, chats, session)
    }
    appendMessage(session, { role: 'user', content: text })
    chats = saveSession(userId, chats, session)
    if (!isControlMessage(text)) updateBehavior(p, [text])
    writeProfile(userId, p)
  }

  if (!session) {
    // 无输入也无会话：等待用户开口，不生成回复
    return Response.json({ reply: '', sessionId: null })
  }

  const history = session.messages.map((m) => ({ role: m.role, content: m.content }))
  const isFirstTurn = history.filter((m) => m.role === 'user').length === 1

  // Skill 调度（P0-2a）：确定性路由优先——测验进行中不重新路由
  const route = quiz ? null : routeSkill(text)
  let out
  if (route?.skill?.id === 'goalBreak') {
    // 命中目标拆解：确定性路由直接执行（LLM 生成 + Mock 兜底）
    out = await generateGoalBreak(text, summary)
  } else if (!process.env.DEEPSEEK_API_KEY) {
    out = mockStar(history, quiz, summary)
  } else {
    try {
      const raw = await callLLM(starMessages({ history, quiz, profileSummary: summary, isFirstTurn }))
      const parsed = parseJson(raw)
      out = {
        reply: parsed?.reply || '嗯，我在。',
        quiz: parsed?.quiz || null,
        result: parsed?.result || null,
        skill: parsed?.skill || null,
      }
    } catch (e) {
      console.warn('[star] 对话失败，降级 Mock：', e.message)
      out = mockStar(history, quiz, summary)
    }
  }

  // 能量意图确定性兜底：用户问了能量/精力方向，但模型只回了对话、没产出结构化结果时，
  // 用规则版补一张"今日能量提示"卡（体验不依赖单次 LLM 的输出稳定性）
  if (!out.quiz && !out.result && !out.skill && /能量|运势|状态|精力/.test(text)) {
    out = mockStar(history, quiz, summary)
  }

  // 本次调度实际执行的技能与来源（rule 命中同技能 → rule；其余 LLM 兜底 → llm）
  const executed = out.skill
    ? { id: out.skill.id, outcome: 'completed' }
    : out.result
      ? { id: out.result.quizId === 'energy' ? 'energy' : 'quiz', outcome: 'completed' }
      : out.quiz
        ? { id: 'quiz', outcome: 'started' }
        : route
          ? { id: route.skill.id, outcome: 'started' }
          : null
  const skillSource = route && executed && route.skill.id === executed.id ? 'rule' : 'llm'

  appendMessage(session, {
    role: 'assistant',
    content: out.reply || '',
    quiz: out.quiz || undefined,
    result: out.result || undefined,
    skill: out.skill || undefined,
  })
  // LLM await 之后重读 chats(清单 A4):避免覆盖并发请求刚写入的会话
  chats = saveSession(userId, readChats(userId), session)

  // 测验结果自动存入测试报告 + Skill 调度留痕 + goalBreak 自动创建目标（同样重读 profile 再写）
  let goalCreated = null
  if (out.result || executed || out.skill) {
    const fresh = readProfile(userId)
    if (out.result) {
      fresh.tests = fresh.tests || []
      fresh.tests.unshift({ date: new Date().toISOString().slice(0, 10), ...out.result })
      trackReq(req, 'quiz_done', '/api/star', { quizId: out.result?.quizId || null })
    }
    if (executed) {
      recordSkillLog(fresh, {
        skillId: executed.id,
        source: skillSource,
        outcome: executed.outcome,
        detail: out.quiz ? out.quiz.title || '' : out.skill ? out.skill.title || '' : '',
      })
    }
    if (out.skill?.id === 'goalBreak') {
      // 目标系统 v1：拆解产出自动落「计划」栏目
      const g = createGoalFromSkill(fresh, out.skill, text)
      if (g) goalCreated = { id: g.id, title: g.title, totalSteps: g.steps.length }
    }
    writeProfile(userId, fresh)
  }

  // 对话内容异步同步目标进度（不阻塞回复）
  if (text && !isControlMessage(text)) {
    syncGoalsInBackground(userId, text)
  }

  return Response.json({ ...out, sessionId: session.id, goal: goalCreated })
}
