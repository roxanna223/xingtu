import { readProfile, writeProfile, readDays } from '@/lib/store'
import { callLLM, parseJson, mockChat } from '@/lib/engine'
import { chatMessages } from '@/lib/prompts'
import { OPENERS } from '@/lib/openers'
import { updateBehavior, behaviorSummary } from '@/lib/behavior'

export async function POST(req) {
  const body = await req.json()
  const { messages = [], draft = null } = body || {}

  const p = readProfile()
  const days = readDays()
  const last = days.at(-1)
  const lastRecord = last ? { date: last.date, q1: last.q1 } : null

  // 开场问题轮换：按心理学框架取一个具体问题，并结合用户画像微调
  let forcedOpener = null
  if (!messages.length) {
    const opener = OPENERS[(p.openerIdx || 0) % OPENERS.length]
    p.openerIdx = (p.openerIdx || 0) + 1
    p.lastOpeners = [...(p.lastOpeners || []), opener.frame].slice(-3)
    forcedOpener = opener
    writeProfile(p)
  }

  // 行为信号采集（自迭代的数据基础）
  updateBehavior(p, messages.filter((m) => m.role === 'user').map((m) => m.content))
  writeProfile(p)
  const behavior = behaviorSummary(p)

  if (!process.env.DEEPSEEK_API_KEY) {
    const m = mockChat(messages, draft, forcedOpener)
    return Response.json({ reply: m.reply, draft: m.draft, done: m.done })
  }

  try {
    const raw = await callLLM(chatMessages({ history: messages, draft, lastRecord, forcedOpener, behavior }))
    const parsed = parseJson(raw)
    const reply = parsed?.reply || '嗯，我在听。'
    const nextDraft = parsed?.draft || null
    const done = !!parsed?.done && !!nextDraft
    return Response.json({ reply, draft: nextDraft, done })
  } catch (e) {
    console.warn('[chat] LLM 失败：', e.message)
    const m = mockChat(messages, draft, forcedOpener)
    return Response.json({ reply: m.reply, draft: m.draft, done: m.done })
  }
}
