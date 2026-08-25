import { readProfile, writeProfile, readDays, readChats } from '@/lib/store'
import { callLLM, parseJson, mockChat } from '@/lib/engine'
import { chatMessages } from '@/lib/prompts'
import { OPENERS } from '@/lib/openers'
import { updateBehavior, behaviorSummary } from '@/lib/behavior'
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
  const { message = '', draft = null, sessionId = null, fresh = false } = body
  const text = String(message || '').trim()

  const p = readProfile(userId)
  const days = readDays(userId)
  let chats = readChats(userId)
  const last = days.at(-1)
  const lastRecord = last ? { date: last.date, q1: last.q1 } : null

  let session = sessionId ? getSession(chats, sessionId) : null

  /* ---------- 页面加载 / 恢复 / 开场（无新消息） ---------- */
  if (!text) {
    if (!session) {
      if (!fresh) {
        // 恢复今天未保存的对话（刷新不再丢失）
        const restorable = findRestorable(chats, 'record')
        if (restorable) {
          return Response.json({ history: restorable.messages, sessionId: restorable.id, covered: false })
        }
        // 今天已保存过记录 → 客户端直接展示"已保存"态
        const todayStr = new Date().toISOString().slice(0, 10)
        if (days.some((d) => d.date === todayStr)) {
          return Response.json({ covered: true, sessionId: null })
        }
      }
      session = newSession('record')
      chats = saveSession(userId, chats, session)
    }

    let reply = ''
    if (!session.messages.length) {
      // 开场问题轮换（心理学框架）
      const opener = OPENERS[(p.openerIdx || 0) % OPENERS.length]
      p.openerIdx = (p.openerIdx || 0) + 1
      p.lastOpeners = [...(p.lastOpeners || []), opener.frame].slice(-3)
      writeProfile(userId, p)
      const behavior = behaviorSummary(p)
      if (!process.env.DEEPSEEK_API_KEY) {
        reply = mockChat([], null, opener).reply
      } else {
        try {
          const raw = await callLLM(chatMessages({ history: [], draft: null, lastRecord, forcedOpener: opener, behavior }))
          const parsed = parseJson(raw)
          reply = parsed?.reply || opener.q
        } catch (e) {
          console.warn('[chat] 开场 LLM 失败：', e.message)
          reply = mockChat([], null, opener).reply
        }
      }
      appendMessage(session, { role: 'assistant', content: reply })
      // LLM await 之后重读 chats(清单 A4):避免覆盖并发请求刚写入的会话
      chats = saveSession(userId, readChats(userId), session)
    }
    return Response.json({ reply, sessionId: session.id, covered: false })
  }

  /* ---------- 正常对话：新消息先落盘，再生成回复 ---------- */
  if (!session) {
    session = newSession('record')
    chats = saveSession(userId, chats, session)
  }
  appendMessage(session, { role: 'user', content: text })
  chats = saveSession(userId, chats, session)

  if (!isControlMessage(text)) {
    // 同步段内重读-更新-写回,与并发请求不会交错(清单 A4)
    const freshP = readProfile(userId)
    updateBehavior(freshP, [text])
    writeProfile(userId, freshP)
  }
  const behavior = behaviorSummary(p)

  const history = session.messages.map((m) => ({ role: m.role, content: m.content }))
  let reply
  let nextDraft = null
  let done = false
  if (!process.env.DEEPSEEK_API_KEY) {
    const m = mockChat(history, draft, null)
    reply = m.reply
    nextDraft = m.draft
    done = m.done
  } else {
    try {
      const raw = await callLLM(chatMessages({ history, draft, lastRecord, forcedOpener: null, behavior }))
      const parsed = parseJson(raw)
      reply = parsed?.reply || '嗯，我在听。'
      nextDraft = parsed?.draft || null
      done = !!parsed?.done && !!nextDraft
    } catch (e) {
      console.warn('[chat] LLM 失败：', e.message)
      const m = mockChat(history, draft, null)
      reply = m.reply
      nextDraft = m.draft
      done = m.done
    }
  }
  appendMessage(session, { role: 'assistant', content: reply })
  // LLM await 之后重读 chats(清单 A4):避免覆盖并发请求刚写入的会话
  chats = saveSession(userId, readChats(userId), session)

  return Response.json({ reply, draft: nextDraft, done, sessionId: session.id })
}
