import { readProfile, readDays } from '@/lib/store'
import { mixEmotionColors } from '@/lib/colors'
import { requireAuth } from '@/lib/auth'

const DAY = 86400000
const DOMAINS = ['事业', '关系', '自我', '健康', '财务', '成长']

export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  const url = new URL(req.url)
  const asOf = url.searchParams.get('asOf')
  const p = readProfile(userId)
  const days = readDays(userId)
  const dates = days.map((d) => d.date)

  const now = asOf ? new Date(`${asOf}T23:59:59`).getTime() : Date.now()
  let topics = p.topics || []
  if (asOf) topics = topics.filter((t) => (t.firstSeen || '') <= asOf)
  const ids = new Set(topics.map((t) => t.id))

  const nodes = topics.map((t) => {
    const ageDays = Math.max(0, (now - new Date(t.lastActive).getTime()) / DAY)
    return {
      id: t.id,
      name: t.name,
      domain: t.domain,
      emotion: t.emotion,
      polarity: t.polarity ?? 0,
      freq: t.freq ?? 1,
      size: 6 + Math.min(22, (t.freq || 1) * 3),
      glow: Math.max(0.25, 1 - ageDays / 10),
      lastActive: t.lastActive,
      quotes: (t.quotes || []).slice(-2),
    }
  })
  const names = Object.fromEntries(topics.map((t) => [t.id, t.name]))
  const edges = (p.edges || [])
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      sourceName: names[e.source],
      targetName: names[e.target],
    }))

  // 六域数据统计（纯规则计算，不调 LLM；随 asOf 过滤后的节点聚合，演化回放时同步变化）
  const totalFreq = nodes.reduce((a, n) => a + (n.freq || 1), 0)
  const domains = DOMAINS.map((d) => {
    const inD = nodes.filter((n) => n.domain === d)
    const freq = inD.reduce((a, n) => a + (n.freq || 1), 0)
    const emoCounts = {}
    for (const n of inD) emoCounts[n.emotion] = (emoCounts[n.emotion] || 0) + (n.freq || 1)
    const emoDist = Object.entries(emoCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([emotion, count]) => ({ emotion, count }))
    const inIds = new Set(inD.map((n) => n.id))
    const edgeCount = edges.filter((e) => inIds.has(e.source) && inIds.has(e.target)).length
    const lastActive = inD.reduce((a, n) => (n.lastActive > a ? n.lastActive : a), '')
    return {
      domain: d,
      topicCount: inD.length,
      freq,
      share: totalFreq ? Math.round((freq / totalFreq) * 100) : 0,
      dominantEmotion: emoDist[0]?.emotion || null,
      emoDist,
      color: emoDist.length ? mixEmotionColors(emoCounts) : '#5a6098',
      edgeCount,
      lastActive,
    }
  })

  return Response.json({
    nodes,
    edges,
    domains,
    dayCount: (p.emotionSeries || []).length,
    dates,
    asOf: asOf || null,
    user: p.user?.username ? { username: p.user.username } : null,
  })
}
