import { readProfile, writeProfile, readDays, withStoreLock } from '@/lib/store'
import { generateReport, generatePeriodReport, PERIOD_CACHE_VERSION } from '@/lib/engine'
import { emotionCountsFromTrack, mixEmotionColors, parseTrackText } from '@/lib/colors'
import { detectIntent, patternTopics } from '@/lib/intent'
import { aggregateRange, currentOrLastComplete, RANGES } from '@/lib/period'
import { consumePendingChats } from '@/lib/chatStore'
import { requireAuth } from '@/lib/auth'
import { trackReq } from '@/lib/track'

export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  try {
    // 全程写锁(清单 A4):报告生成含 LLM await,与 record 后台链串行,避免交错写画像
    const res = await withStoreLock(async () => {
      const url = new URL(req.url)
      const tier = url.searchParams.get('tier')
      const date = url.searchParams.get('date')
      const range = url.searchParams.get('range')
      const refresh = url.searchParams.get('refresh') === '1'

      // P0-1：报告生成前把未抽取的对话并入画像，报告才完整（无待处理时近乎零成本）
      let p = readProfile(userId)
      if (!p.generating) {
        await consumePendingChats(userId)
        p = readProfile(userId)
      }
      const days = readDays(userId)
      const dates = days.map((d) => d.date)
      const lastDay = dates.at(-1) || ''
      const todayStr = new Date().toISOString().slice(0, 10)

      /* ---------- 周期报告：按自然周期划分，周期满了才生成；缓存 key 含周期起点 ---------- */
      if (range && RANGES[range]) {
        const period = currentOrLastComplete(range, todayStr)
        const cached = p.periodReports?.[range]
        if (!refresh && cached && cached.generatedAt && cached.cacheVersion === PERIOD_CACHE_VERSION && cached.start === period.start) {
          return Response.json({ ...cached, range, periodLabel: period.periodLabel })
        }
        const agg = aggregateRange(p, days, range, todayStr)
        const rep = await generatePeriodReport(p, agg)
        rep.range = range
        rep.start = period.start
        rep.end = period.end
        rep.periodLabel = period.periodLabel
        rep.dataNote = agg.dataNote
        rep.totalDays = agg.totalDays
        p.periodReports = p.periodReports || {}
        p.periodReports[range] = rep
        writeProfile(userId, p)
        return Response.json({ ...rep, range })
      }

      /* ---------- 最新报告正在后台生成时，立即返回状态，不阻塞 ---------- */
      if (!date && !range && p.generating) {
        return Response.json({ generating: true, dates, track: [] })
      }

      /* ---------- 历史日报告：首看生成后缓存，refresh 才重新生成 ---------- */
      if (date) {
        if (!refresh && p.reports?.[date] && p.reports[date].generatedAt) {
          return Response.json({ ...p.reports[date], dates, track: parseTrackText(p.reports[date].trackText || '') })
        }
        const topics = (p.topics || []).filter((t) => (t.firstSeen || '') <= date)
        const ids = new Set(topics.map((t) => t.id))
        const profileForReport = {
          ...p,
          topics,
          edges: (p.edges || []).filter((e) => ids.has(e.source) && ids.has(e.target)),
          emotionSeries: (p.emotionSeries || []).filter((e) => e.date <= date),
          feedbackLog: (p.feedbackLog || []).filter((f) => f.date <= date),
        }
        const dayRecord = days.find((d) => d.date === date)
        const todayTrack = dayRecord?.q2 || ''
        const intent = detectIntent(`${dayRecord?.freeText || ''} ${dayRecord?.q1 || ''} ${dayRecord?.q3 || ''}`)
        const patterns = patternTopics(profileForReport)
        const report = await generateReport(profileForReport, tier === 'logical' || tier === 'result' ? tier : null, todayTrack, dayRecord || null, intent, patterns)
        report.moodColor = report.moodColor || mixEmotionColors(emotionCountsFromTrack(todayTrack))
        report.trackText = todayTrack
        p.reports = p.reports || {}
        p.reports[date] = report
        writeProfile(userId, p)
        return Response.json({ ...report, dates, track: parseTrackText(todayTrack) })
      }

      /* ---------- 最新报告：当日缓存（有新记录后自动重新生成） ---------- */
      if (!tier && p.lastReport?.generatedAt && lastDay && p.lastReport.generatedAt >= lastDay) {
        return Response.json({ ...p.lastReport, dates, track: parseTrackText(p.lastReport.trackText || '') })
      }
      const dayRecord = days.at(-1)
      const todayTrack = dayRecord?.q2 || ''
      const intent = detectIntent(`${dayRecord?.freeText || ''} ${dayRecord?.q1 || ''} ${dayRecord?.q3 || ''}`)
      const patterns = patternTopics(p)
      const report = await generateReport(p, tier === 'logical' || tier === 'result' ? tier : null, todayTrack, dayRecord || null, intent, patterns)
      report.moodColor = report.moodColor || mixEmotionColors(emotionCountsFromTrack(todayTrack))
      report.trackText = todayTrack
      writeProfile(userId, p)
      return Response.json({ ...report, dates, track: parseTrackText(todayTrack) })
    })
    trackReq(req, 'report_view', '/api/report', { range: new URL(req.url).searchParams.get('range'), date: new URL(req.url).searchParams.get('date') })
    return res
  } catch (e) {
    console.error('[report] 生成失败：', e)
    return Response.json({ error: '报告生成失败，请稍后重试' }, { status: 500 })
  }
}
