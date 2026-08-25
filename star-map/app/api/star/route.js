import { readProfile, writeProfile, readChats } from '@/lib/store'
import { callLLM, parseJson, mockStar, mockSuggestions, buildProfileSummary } from '@/lib/engine'
import { starMessages, suggestionsMessages } from '@/lib/prompts'
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

  // 快速开始提示生成（不落盘）
  if (mode === 'suggestions') {
    if (!process.env.DEEPSEEK_API_KEY) return Response.json(mockSuggestions(summary))
    try {
      const raw = await callLLM(suggestionsMessages(summary))
      const parsed = parseJson(raw)
      if (parsed && Array.isArray(parsed.suggestions) && parsed.suggestions.length) {
        return Response.json({ suggestions: parsed.suggestions.slice(0, 3) })
      }
    } catch (e) {
      console.warn('[star] suggestions 失败：', e.message)
    }
    return Response.json(mockSuggestions(summary))
  }

  // 页面加载恢复：找回最近一次未结束的小星对话（刷新不再丢失）
  if (mode === 'restore') {
    const s = findRestorable(readChats(userId), 'star')
    if (s) return Response.json({ history: s.messages, sessionId: s.id })
    return Response.json({ history: null, sessionId: null })
  }

  /* ---------- 对话 / 测验 ---------- */
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
  let out
  if (!process.env.DEEPSEEK_API_KEY) {
    out = mockStar(history, quiz, summary)
  } else {
    try {
      const raw = await callLLM(starMessages({ history, quiz, profileSummary: summary }))
      const parsed = parseJson(raw)
      out = {
        reply: parsed?.reply || '嗯，我在。',
        quiz: parsed?.quiz || null,
        result: parsed?.result || null,
      }
    } catch (e) {
      console.warn('[star] 对话失败，降级 Mock：', e.message)
      out = mockStar(history, quiz, summary)
    }
  }

  // 能量意图确定性兜底：用户问了能量/精力方向，但模型只回了对话、没产出结构化 result 时，
  // 用规则版补一张"今日能量提示"卡（体验不依赖单次 LLM 的输出稳定性）
  if (!out.quiz && !out.result && /能量|运势|状态|精力/.test(text)) {
    out = mockStar(history, quiz, summary)
  }

  appendMessage(session, {
    role: 'assistant',
    content: out.reply || '',
    quiz: out.quiz || undefined,
    result: out.result || undefined,
  })
  // LLM await 之后重读 chats(清单 A4):避免覆盖并发请求刚写入的会话
  chats = saveSession(userId, readChats(userId), session)

  // 测验结果自动存入测试报告(同样重读 profile 再写)
  if (out.result) {
    const fresh = readProfile(userId)
    fresh.tests = fresh.tests || []
    fresh.tests.unshift({ date: new Date().toISOString().slice(0, 10), ...out.result })
    writeProfile(userId, fresh)
    trackReq(req, 'quiz_done', '/api/star', { quizId: out.result?.quizId || null })
  }

  return Response.json({ ...out, sessionId: session.id })
}
