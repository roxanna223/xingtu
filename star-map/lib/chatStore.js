// P0-1 对话持久化与入画像
// - 会话管理：记录页对话（source=record）与小星对话（source=star）的完整消息落盘（data/chats.json）
// - 入画像：未抽取的用户消息按日期分组，走与 /api/record 相同的 extractAndMerge 管道
// - 防重复计数：被记录保存覆盖的会话（covered）标记为已抽取；consume 有进程内互斥
import { readChats, writeChats, readProfile, writeProfile } from './store'
import { extractAndMerge } from './engine'
import { fakeNow, fakeTodayISO } from './clock.js'

const today = () => fakeTodayISO()
const ts = () => fakeNow().toISOString()
const MAX_SESSIONS = 40 // 只保留最近 40 个会话，含未抽取消息的会话永不裁剪

// 控制消息：不参与画像抽取与行为统计
export function isControlMessage(text) {
  const s = String(text || '').trim()
  return /^\[帮我梳理今天\]$/.test(s) || /^我选[:：]/.test(s)
}

export function newSession(source) {
  return {
    id: 'c' + Math.random().toString(36).slice(2, 10),
    source,
    day: today(),
    messages: [],
    covered: false, // 该会话已被"保存记录"覆盖（内容已通过 /api/record 抽取），不再重复抽取
    createdAt: ts(),
    updatedAt: ts(),
  }
}

export function getSession(chats, id) {
  return chats.find((c) => c.id === id) || null
}

// 找最近一个可恢复的当日会话（有消息、未被记录覆盖）
export function findRestorable(chats, source) {
  return (
    [...chats]
      .reverse()
      .find((c) => c.source === source && c.day === today() && !c.covered && (c.messages || []).length > 0) || null
  )
}

export function appendMessage(session, msg) {
  session.messages.push({ ts: ts(), extracted: false, ...msg })
  session.updatedAt = ts()
  return session
}

export function hasPending(c) {
  return (c.messages || []).some((m) => m.role === 'user' && !m.extracted && !isControlMessage(m.content))
}

export function pendingChatCount(chats) {
  return (chats || []).reduce(
    (n, c) => n + (c.messages || []).filter((m) => m.role === 'user' && !m.extracted && !isControlMessage(m.content)).length,
    0
  )
}

export function saveSession(userId, chats, session) {
  const i = chats.findIndex((c) => c.id === session.id)
  if (i >= 0) chats[i] = session
  else chats.push(session)
  const sorted = [...chats].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  const pending = sorted.filter(hasPending)
  const rest = sorted.filter((c) => !hasPending(c)).slice(0, Math.max(0, MAX_SESSIONS - pending.length))
  const pruned = [...pending, ...rest]
  writeChats(userId, pruned)
  return pruned
}

// 把某个会话标记为"已被记录覆盖"：内容已通过 /api/record 抽取，避免重复入画像
export function markSessionCovered(userId, chats, sessionId) {
  const s = chats.find((c) => c.id === sessionId)
  if (!s) return false
  s.covered = true
  s.updatedAt = ts()
  for (const m of s.messages || []) {
    m.extracted = true
    m.extractedAt = m.extractedAt || ts()
  }
  writeChats(userId, chats)
  return true
}

// 纯函数：把未抽取的对话内容并入画像（按日期分组，一天一次抽取；成功才标记 extracted）
export async function consumeChatsIntoProfile(chats, profile) {
  const items = []
  for (const c of chats || []) {
    for (const m of c.messages || []) {
      if (!m.extracted && m.role === 'user' && !isControlMessage(m.content) && String(m.content || '').trim().length >= 2) {
        items.push({ session: c, msg: m, date: (m.ts || today()).slice(0, 10) })
      }
    }
  }
  if (!items.length) return { extractedDates: [], extractedCount: 0 }

  const byDate = new Map()
  for (const it of items) {
    if (!byDate.has(it.date)) byDate.set(it.date, [])
    byDate.get(it.date).push(it)
  }

  const extractedDates = []
  let extractedCount = 0
  for (const [date, group] of byDate) {
    const text = group.map((g) => String(g.msg.content).trim()).join('\n')
    if (!text) continue
    const record = { date, freeText: text, q1: '', q2: '', q3: '' }
    try {
      await extractAndMerge(record, profile)
      for (const g of group) {
        g.msg.extracted = true
        g.msg.extractedAt = ts()
      }
      extractedDates.push(date)
      extractedCount += group.length
    } catch (e) {
      console.warn(`[chatStore] 对话抽取失败（${date}）：`, e.message)
    }
  }
  return { extractedDates, extractedCount }
}

let consuming = false

// 带互斥与落盘的消费入口：任何触发点调用都安全（并发时后到者直接跳过）
export async function consumePendingChats(userId) {
  if (consuming) return { consumed: 0, skipped: true }
  consuming = true
  try {
    const chats = readChats(userId)
    if (!pendingChatCount(chats)) return { consumed: 0, skipped: false }
    const profile = readProfile(userId)
    const r = await consumeChatsIntoProfile(chats, profile)
    if (r.extractedCount) {
      writeChats(userId, chats)
      writeProfile(userId, profile)
    }
    return { consumed: r.extractedCount, dates: r.extractedDates }
  } catch (e) {
    console.warn('[chatStore] consumePendingChats 失败：', e.message)
    return { consumed: 0, error: e.message }
  } finally {
    consuming = false
  }
}
