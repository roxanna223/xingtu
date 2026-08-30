// 周期报告（周/月/季/年）：按自然周期划分，周期满了才生成
// 规则：本周已结束（过了周日）→ 周报生成"上一自然周"；今天恰是周日/月末/季末/年末 → 生成本周期
import { emotionCountsFromTrack, mixEmotionColors } from './colors.js'

export const RANGES = {
  week: { label: '周报' },
  month: { label: '月报' },
  quarter: { label: '季报' },
  year: { label: '年报' },
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function parse(str) {
  const [y, m, d] = String(str).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(str, n) {
  const d = parse(str)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function lastDayOfMonth(y, m) {
  return new Date(y, m, 0).getDate()
}

// 计算当前可生成的周期区间（满了才生成；否则用上一完整周期）
export function currentOrLastComplete(range, nowStr) {
  const now = parse(nowStr)
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const d = now.getDate()

  if (range === 'week') {
    const dow = (now.getDay() + 6) % 7 // 0=周一 … 6=周日
    if (dow === 6) return { start: addDays(nowStr, -6), end: nowStr, periodLabel: '本周' }
    const thisMon = addDays(nowStr, -dow)
    return { start: addDays(thisMon, -7), end: addDays(thisMon, -1), periodLabel: '上周' }
  }

  if (range === 'month') {
    if (d === lastDayOfMonth(y, m)) return { start: `${y}-${pad(m)}-01`, end: nowStr, periodLabel: '本月' }
    const py = m === 1 ? y - 1 : y
    const pm = m === 1 ? 12 : m - 1
    return { start: `${py}-${pad(pm)}-01`, end: `${py}-${pad(pm)}-${pad(lastDayOfMonth(py, pm))}`, periodLabel: '上月' }
  }

  if (range === 'quarter') {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1 // 1/4/7/10
    const qEnd = qStart + 2
    if (m === qEnd && d === lastDayOfMonth(y, qEnd)) {
      return { start: `${y}-${pad(qStart)}-01`, end: nowStr, periodLabel: '本季度' }
    }
    let py = y
    let ps = qStart - 3
    if (ps < 1) {
      ps = 10
      py = y - 1
    }
    const pe = ps + 2
    return { start: `${py}-${pad(ps)}-01`, end: `${py}-${pad(pe)}-${pad(lastDayOfMonth(py, pe))}`, periodLabel: '上一季度' }
  }

  if (range === 'year') {
    if (m === 12 && d === 31) return { start: `${y}-01-01`, end: nowStr, periodLabel: '今年' }
    return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31`, periodLabel: '去年' }
  }

  return { start: nowStr, end: nowStr, periodLabel: '' }
}

// 聚合指定周期区间的数据（规则版，不依赖 LLM）
export function aggregateRange(profile, days, range, nowStr) {
  const { start, end, periodLabel } = currentOrLastComplete(range, nowStr)
  const inDays = days.filter((d) => d.date >= start && d.date <= end)
  const series = (profile.emotionSeries || []).filter((e) => e.date >= start && e.date <= end)

  const emotionDist = {}
  for (const s of series) emotionDist[s.topEmotion] = (emotionDist[s.topEmotion] || 0) + 1

  const trackAll = inDays.map((d) => d.q2 || '').filter(Boolean).join('、')
  const counts = emotionCountsFromTrack(trackAll)

  const topics = (profile.topics || [])
    .filter((t) => (t.firstSeen || '') <= end && (t.lastActive || '') >= start)
    .sort((a, b) => (b.freq || 0) - (a.freq || 0))

  const totalDays = Math.round((parse(end) - parse(start)) / 86400000) + 1
  const ratio = totalDays ? inDays.length / totalDays : 0
  const dataNote =
    inDays.length === 0
      ? '该周期还没有记录。'
      : ratio < 0.5
        ? `本周期只记录了 ${inDays.length}/${totalDays} 天，数据不全面，结论可能有偏差。`
        : ''

  return {
    range,
    label: RANGES[range].label,
    periodLabel,
    start,
    end,
    dayCount: inDays.length,
    inDays: inDays.length,
    totalDays,
    dataNote,
    emotionDist,
    moodColor: mixEmotionColors(counts),
    trackAll,
    topTopics: topics.slice(0, 5).map((t) => ({
      name: t.name,
      domain: t.domain,
      freq: t.freq,
      emotion: t.emotion,
      quotes: (t.quotes || []).slice(-2),
    })),
    seriesCount: series.length,
  }
}
