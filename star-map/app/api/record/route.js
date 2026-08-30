import { readProfile, writeProfile, readDays, writeDays, readChats, readStream, withStoreLock } from '@/lib/store'
import { extractAndMerge, generateReport } from '@/lib/engine'
import { syncGoalsWithText } from '@/lib/goals'
import { updateBehavior } from '@/lib/behavior'
import { detectIntent, patternTopics } from '@/lib/intent'
import { markSessionCovered, consumePendingChats } from '@/lib/chatStore'
import { rebuildPersonaDocs } from '@/lib/evolution'
import { formatStream } from '@/lib/stream'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'

export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { date, freeText, q1 = '', q2 = '', q3 = '', sessionId = null } = body
  if (!date || !freeText || !String(freeText).trim()) {
    return Response.json({ error: 'date 与 freeText 必填' }, { status: 400 })
  }
  const record = { date: String(date).slice(0, 10), freeText: String(freeText).trim().slice(0, 5000), q1: String(q1).trim().slice(0, 2000), q2: String(q2).trim().slice(0, 2000), q3: String(q3).trim().slice(0, 2000) }

  // 写锁串行化读-改-写(清单 A4):extractAndMerge 含 LLM await,期间禁止其他请求交错写画像
  const { result, topicCount, dayCount } = await withStoreLock(async () => {
    const p = readProfile(userId)
    const result = await extractAndMerge(record, p)
    updateBehavior(p, [record.freeText, record.q1, record.q3])
    p.generating = true
    writeProfile(userId, p)

    const days = readDays(userId)
    const i = days.findIndex((d) => d.date === record.date)
    if (i >= 0) days[i] = record
    else days.push(record)
    days.sort((a, b) => a.date.localeCompare(b.date))
    writeDays(userId, days)

    // P0-1：本次保存来自对话 → 该会话内容已通过上面的抽取进入画像，标记 covered 防重复抽取
    if (sessionId) {
      markSessionCovered(userId, readChats(userId), String(sessionId).slice(0, 40))
    }

    return { result, topicCount: p.topics.length, dayCount: days.length }
  })

  // 后台：① 把其余未抽取的对话并入画像 → ② 生成当日日报（同一条串行链 + 写锁，避免并发写画像）
  ;(async () => {
    try {
      await withStoreLock(async () => {
        await consumePendingChats(userId)
        const latest = readProfile(userId)
        const lastD = readDays(userId).at(-1)
        const track = lastD?.q2 || ''
        const intent = detectIntent(`${lastD?.freeText || ''} ${lastD?.q1 || ''} ${lastD?.q3 || ''}`)
        const patterns = patternTopics(latest)
        const streamText = formatStream(readStream(userId, lastD?.date || record.date))
        const rep = await generateReport(latest, null, track, lastD || null, intent, patterns, streamText)
        const fresh = readProfile(userId)
        fresh.lastReport = rep
        fresh.reports = fresh.reports || {}
        if (lastD) {
          rep.dayKey = lastD.date
          fresh.reports[lastD.date] = { ...rep, trackText: track }
        }
        // 目标系统 v1：当日记录自动同步目标进度（LLM 判定 + 规则兜底）
        const dayText = `${lastD?.freeText || ''} ${lastD?.q1 || ''} ${lastD?.q3 || ''}`.trim()
        if (dayText && (fresh.goals || []).some((g) => g.status === 'active')) {
          await syncGoalsWithText(fresh, dayText, 'record')
        }
        rebuildPersonaDocs(userId, fresh)
        fresh.generating = false
        writeProfile(userId, fresh)
      })
    } catch (e) {
      await withStoreLock(() => {
        const fresh = readProfile(userId)
        fresh.generating = false
        writeProfile(userId, fresh)
      })
      console.warn('[record] 后台生成日报失败：', e.message)
    }
  })()

  trackReq(req, 'record_save', '/api/record')
  return Response.json({ ok: true, crisis: !!result.crisis, topicCount, dayCount })
}
