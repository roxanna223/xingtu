import { readProfile, writeProfile, readChats, appendStream, withStoreLock } from '@/lib/store'
import { callLLM, parseJson, mockStar, mockStarGuide, mockSuggestions, buildProfileSummary, generateGoalBreak } from '@/lib/engine'
import { starMessages, suggestionsMessages, starGuideMessages } from '@/lib/prompts'
import { allQuizzes, saveCustomQuiz } from '@/lib/quizzes'
import { routeSkill, recordSkillLog } from '@/lib/skills'
import { createGoalFromSkill, syncGoalsWithText } from '@/lib/goals'
import { updateBehavior } from '@/lib/behavior'
import { buildPersonaSummary, observeSession, applyUserSignal } from '@/lib/evolution'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'
import { dayKeyOfIso, nowIso } from '@/lib/day'
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
  const { message = '', quiz = null, mode = 'chat', sessionId = null, guide = false, draft = null } = body
  const text = String(message || '').trim().slice(0, 2000)
  if (text) trackReq(req, 'chat_message', '/api/star')

  const p = readProfile(userId)
  const summary = buildProfileSummary(p)
  const personaSummary = buildPersonaSummary(userId, p)

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
    // 兼容旧版字符串提示，统一转卡片对象（保留 quizHint 供前端测验卡提示）
    suggestions = suggestions.map((s) =>
      typeof s === 'string'
        ? { title: s.slice(0, 8), text: s, tag: '引导', guide: /理一理|梳理|记录/.test(s), quizHint: '' }
        : { title: String(s.title || s.text || '').slice(0, 8), text: String(s.text || s.title || ''), tag: s.tag || '轻松', guide: !!s.guide, quizHint: String(s.quizHint || '').slice(0, 12) }
    )
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
    // 人生事件流：用户本轮消息（6:00 划日归桶）
    appendStream(userId, { day: dayKeyOfIso(nowIso()), kind: 'chat_turn', data: { role: 'user', text: text.slice(0, 500), guide: !!guide } })
  }

  if (!session) {
    // 无输入也无会话：等待用户开口，不生成回复
    return Response.json({ reply: '', sessionId: null })
  }

  const history = session.messages.map((m) => ({ role: m.role, content: m.content }))
  const isFirstTurn = history.filter((m) => m.role === 'user').length === 1

  // Skill 调度（P0-2a）：确定性路由优先——测验进行中不重新路由；引导模式内不做技能路由
  const route = quiz || guide ? null : routeSkill(text)
  let out
  if (guide) {
    // 记录引导模式（docs/23 §4.2）：心理侧写式引导，产出可编辑梳理卡
    if (!process.env.DEEPSEEK_API_KEY) {
      out = mockStarGuide(history, draft)
    } else {
      try {
        const raw = await callLLM(starGuideMessages({ history, profileSummary: summary, personaSummary, draft }))
        const parsed = parseJson(raw)
        out = parsed?.reply
          ? { reply: parsed.reply, draft: parsed?.draft || null, done: !!parsed?.done && !!parsed?.draft }
          : mockStarGuide(history, draft)
      } catch (e) {
        console.warn('[star] 引导失败，降级 Mock：', e.message)
        out = mockStarGuide(history, draft)
      }
    }
  } else if (route?.skill?.id === 'goalBreak') {
    // 命中目标拆解：确定性路由直接执行（LLM 生成 + Mock 兜底）
    out = await generateGoalBreak(text, summary)
  } else if (!process.env.DEEPSEEK_API_KEY) {
    out = mockStar(history, quiz, summary)
  } else {
    try {
      const raw = await callLLM(starMessages({ history, quiz, profileSummary: summary, isFirstTurn, personaSummary }))
      const parsed = parseJson(raw)
      // 题库外主题的现场创作测验：沉淀进 custom-quizzes.json，下次直接复用
      const freshQuiz = parsed?.freshQuiz
      if (freshQuiz?.id && Array.isArray(freshQuiz.questions) && freshQuiz.questions.length && Array.isArray(freshQuiz.results) && freshQuiz.results.length) {
        if (!allQuizzes()[freshQuiz.id]) {
          saveCustomQuiz(freshQuiz.id, freshQuiz)
          console.log(`[star] 新测验「${freshQuiz.title}」已沉淀进题库（${freshQuiz.id}）`)
        }
      }
      // LLM 空回复/结构异常时降级规则承接句，绝不回"嗯，我在。"这类敷衍兜底
      out = parsed?.reply
        ? { reply: parsed.reply, quiz: parsed?.quiz || null, result: parsed?.result || null, skill: parsed?.skill || null }
        : mockStar(history, quiz, summary)
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

  // 说错话纠正（F9/F10）：用户指出小星记错/串台 → 惩罚相关记忆条目并落盘（不阻塞回复）
  if (text && !isControlMessage(text) && /你说错|你记错|记错了|记忆错乱|说岔了|又乱说|串台/.test(text)) {
    try {
      await withStoreLock(async () => {
        const fp = readProfile(userId)
        fp.personaMeta = applyUserSignal(fp.personaMeta || [], { signal: 'correct', keywords: [text.slice(0, 40)] })
        writeProfile(userId, fp)
      })
    } catch (e) {
      console.warn('[star] 纠正信号应用失败：', e.message)
    }
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
    draft: out.draft || undefined,
  })
  // LLM await 之后重读 chats(清单 A4):避免覆盖并发请求刚写入的会话
  chats = saveSession(userId, readChats(userId), session)
  // 人生事件流：小星本轮回复
  appendStream(userId, { day: dayKeyOfIso(nowIso()), kind: 'chat_turn', data: { role: 'assistant', text: (out.reply || '').slice(0, 500), guide: !!guide } })

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

  // 进化层：后台观察（不阻塞回复；Mock 模式内部直接跳过）
  if (text && !isControlMessage(text)) {
    observeSession(userId, history.slice(-8).map((m) => m.content).join('\n'), summary).catch(() => {})
  }

  return Response.json({ ...out, sessionId: session.id, goal: goalCreated, guide: !!guide })
}
