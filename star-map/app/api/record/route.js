import { readProfile, writeProfile, readDays, writeDays, readChats } from '@/lib/store'
import { extractAndMerge, generateReport } from '@/lib/engine'
import { updateBehavior } from '@/lib/behavior'
import { detectIntent, patternTopics } from '@/lib/intent'
import { markSessionCovered, consumePendingChats } from '@/lib/chatStore'

export async function POST(req) {
  const body = await req.json()
  const { date, freeText, q1 = '', q2 = '', q3 = '', sessionId = null } = body || {}
  if (!date || !freeText || !String(freeText).trim()) {
    return Response.json({ error: 'date 与 freeText 必填' }, { status: 400 })
  }
  const record = { date, freeText: String(freeText).trim(), q1: String(q1).trim(), q2: String(q2).trim(), q3: String(q3).trim() }

  const p = readProfile()
  const result = await extractAndMerge(record, p)
  updateBehavior(p, [record.freeText, record.q1, record.q3])
  p.generating = true
  writeProfile(p)

  const days = readDays()
  const i = days.findIndex((d) => d.date === date)
  if (i >= 0) days[i] = record
  else days.push(record)
  days.sort((a, b) => a.date.localeCompare(b.date))
  writeDays(days)

  // P0-1：本次保存来自对话 → 该会话内容已通过上面的抽取进入画像，标记 covered 防重复抽取
  if (sessionId) {
    markSessionCovered(readChats(), sessionId)
  }

  // 后台：① 把其余未抽取的对话并入画像 → ② 生成当日日报（同一条串行链，避免并发写画像）
  ;(async () => {
    try {
      await consumePendingChats()
      const latest = readProfile()
      const lastD = readDays().at(-1)
      const track = lastD?.q2 || ''
      const intent = detectIntent(`${lastD?.freeText || ''} ${lastD?.q1 || ''} ${lastD?.q3 || ''}`)
      const patterns = patternTopics(latest)
      const rep = await generateReport(latest, null, track, lastD || null, intent, patterns)
      const fresh = readProfile()
      fresh.lastReport = rep
      fresh.reports = fresh.reports || {}
      if (lastD) fresh.reports[lastD.date] = { ...rep, trackText: track }
      fresh.generating = false
      writeProfile(fresh)
    } catch (e) {
      const fresh = readProfile()
      fresh.generating = false
      writeProfile(fresh)
      console.warn('[record] 后台生成日报失败：', e.message)
    }
  })()

  return Response.json({ ok: true, crisis: !!result.crisis, topicCount: p.topics.length, dayCount: days.length })
}
