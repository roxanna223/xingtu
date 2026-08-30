import { readProfile, writeProfile, readDays, readStream, listStreamDays, withStoreLock } from '@/lib/store'
import { generateReport, generatePeriodReport, PERIOD_CACHE_VERSION, adoptionContext } from '@/lib/engine'
import { emotionCountsFromTrack, mixEmotionColors, parseTrackText } from '@/lib/colors'
import { detectIntent, patternTopics } from '@/lib/intent'
import { aggregateRange, currentOrLastComplete, RANGES } from '@/lib/period'
import { consumePendingChats } from '@/lib/chatStore'
import { formatStream } from '@/lib/stream'
import { todayKey } from '@/lib/day'
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
      // 6:00 划日（docs/23 §3.2）：日报的自然日 = 当天 06:00 ~ 次日 05:59
      const todayStr = todayKey()
      // 最新日报 = 最近一个有内容的日子（日记或对话）；6:00 后自然落到"刚关闭的昨天"
      const contentDates = [...new Set([...days.map((d) => d.date), ...listStreamDays(userId)])].sort()
      const latestContentDay = contentDates.at(-1) || todayStr

      /* ---------- 周期报告：按自然周期划分，周期满了才生成；缓存 key 含周期起点 ---------- */
      if (range && RANGES[range]) {
        const period = currentOrLastComplete(range, todayStr)
        const cached = p.periodReports?.[range]
        if (!refresh && cached && cached.generatedAt && cached.cacheVersion === PERIOD_CACHE_VERSION && cached.start === period.start) {
          const adoption = (p.adoptions || []).find((a) => a.reportKey === `${range}:${period.start}`) || null
          return Response.json({ ...cached, range, periodLabel: period.periodLabel, adoption })
        }
        const agg = aggregateRange(p, days, range, todayStr)
        // F18：周期诚实——记录天数不足 2 天时不生成结论（不拿 1 天数据下总结）
        if ((agg.inDays || 0) < 2) {
          return Response.json({
            minimal: true,
            range,
            periodLabel: period.periodLabel,
            playback: `这个周期只记录了 ${agg.inDays} 天，还不足以做总结。继续记录，数据够了再回来看。`,
            trends: [],
            observations: [],
            dates,
          })
        }
        // P0 采纳闭环：周期报告注入采纳上下文与采纳率（北极星过程指标）
        agg.adoptions = adoptionContext(p, { start: period.start, end: period.end })
        const done = agg.adoptions.filter((a) => a.adopted).length
        agg.adoptionNote = agg.adoptions.length
          ? `本周期标记了 ${agg.adoptions.length} 条建议：已做 ${done} 条、还没做 ${agg.adoptions.length - done} 条。`
          : ''
        const rep = await generatePeriodReport(p, agg)
        rep.range = range
        rep.start = period.start
        rep.end = period.end
        rep.periodLabel = period.periodLabel
        rep.dataNote = agg.dataNote
        rep.totalDays = agg.totalDays
        rep.adoptionNote = agg.adoptionNote
        p.periodReports = p.periodReports || {}
        p.periodReports[range] = rep
        writeProfile(userId, p)
        const adoption = (p.adoptions || []).find((a) => a.reportKey === `${range}:${period.start}`) || null
        return Response.json({ ...rep, range, adoption })
      }

      /* ---------- 今天的日报还没到时间：诚实告知（F13）——明天 6:00 生成，先给即时小结 ---------- */
      if (!date && !range) {
        const todayCached = p.reports?.[latestContentDay]?.generatedAt
        if (p.generating || (latestContentDay === todayStr && !todayCached)) {
          return Response.json({
            pending: true,
            todaySummary: p.daySummaries?.[latestContentDay]?.text || '',
            dates,
            track: [],
          })
        }
      }

      /* ---------- 历史日报告：首看生成后缓存，refresh 才重新生成；含当日对话事件流 ---------- */
      if (date) {
        const adoption = (p.adoptions || []).find((a) => a.reportKey === `day:${date}`) || null
        // 今天的报告：6:00 前不生成（F13 诚实告知），除非 refresh 强制
        if (!refresh && date === todayStr && !p.reports?.[date]?.generatedAt) {
          return Response.json({ pending: true, todaySummary: p.daySummaries?.[date]?.text || '', dates, track: [] })
        }
        if (!refresh && p.reports?.[date] && p.reports[date].generatedAt) {
          return Response.json({ ...p.reports[date], dates, track: parseTrackText(p.reports[date].trackText || ''), adoption })
        }
        const topics = (p.topics || []).filter((t) => (t.firstSeen || '') <= date)
        const ids = new Set(topics.map((t) => t.id))
        const profileForReport = {
          ...p,
          topics,
          edges: (p.edges || []).filter((e) => ids.has(e.source) && ids.has(e.target)),
          emotionSeries: (p.emotionSeries || []).filter((e) => e.date <= date),
          feedbackLog: (p.feedbackLog || []).filter((f) => f.date <= date),
          adoptions: (p.adoptions || []).filter((a) => a.date <= date),
        }
        const dayRecord = days.find((d) => d.date === date)
        const todayTrack = dayRecord?.q2 || ''
        const streamText = formatStream(readStream(userId, date))
        const intent = detectIntent(`${dayRecord?.freeText || ''} ${dayRecord?.q1 || ''} ${dayRecord?.q3 || ''} ${streamText}`)
        const patterns = patternTopics(profileForReport)
        const report = await generateReport(profileForReport, tier === 'logical' || tier === 'result' ? tier : null, todayTrack, dayRecord || null, intent, patterns, streamText)
        report.moodColor = report.moodColor || mixEmotionColors(emotionCountsFromTrack(todayTrack))
        report.trackText = todayTrack
        p.reports = p.reports || {}
        p.reports[date] = report
        writeProfile(userId, p)
        return Response.json({ ...report, dates, track: parseTrackText(todayTrack), adoption })
      }

      /* ---------- 最新报告（最近有内容的日子；6:00 划日缓存，跨日自动重生成） ---------- */
      if (!tier && p.lastReport?.dayKey === latestContentDay && p.lastReport.generatedAt) {
        const adoption = (p.adoptions || []).find((a) => a.reportKey === `day:${latestContentDay}`) || null
        return Response.json({ ...p.lastReport, dates, track: parseTrackText(p.lastReport.trackText || ''), adoption })
      }
      const dayRecord = days.find((d) => d.date === latestContentDay)
      const todayTrack = dayRecord?.q2 || ''
      const streamText = formatStream(readStream(userId, latestContentDay))
      const intent = detectIntent(`${dayRecord?.freeText || ''} ${dayRecord?.q1 || ''} ${dayRecord?.q3 || ''} ${streamText}`)
      const patterns = patternTopics(p)
      const report = await generateReport(p, tier === 'logical' || tier === 'result' ? tier : null, todayTrack, dayRecord || null, intent, patterns, streamText)
      report.moodColor = report.moodColor || mixEmotionColors(emotionCountsFromTrack(todayTrack))
      report.trackText = todayTrack
      report.dayKey = latestContentDay
      p.lastReport = report
      p.reports = p.reports || {}
      p.reports[latestContentDay] = { ...report, trackText: todayTrack }
      writeProfile(userId, p)
      const adoption = (p.adoptions || []).find((a) => a.reportKey === `day:${latestContentDay}`) || null
      return Response.json({ ...report, dates, track: parseTrackText(todayTrack), adoption })
    })
    trackReq(req, 'report_view', '/api/report', { range: new URL(req.url).searchParams.get('range'), date: new URL(req.url).searchParams.get('date') })
    return res
  } catch (e) {
    console.error('[report] 生成失败：', e)
    return Response.json({ error: '报告生成失败，请稍后重试' }, { status: 500 })
  }
}
