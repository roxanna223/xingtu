import { readProfile, readDays } from '@/lib/store'

const DAY = 86400000

export async function GET(req) {
  const url = new URL(req.url)
  const asOf = url.searchParams.get('asOf')
  const p = readProfile()
  const days = readDays()
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
  return Response.json({
    nodes,
    edges,
    dayCount: (p.emotionSeries || []).length,
    dates,
    asOf: asOf || null,
    user: p.user?.username
      ? { username: p.user.username, starSign: p.user.starSign || null, starSymbol: p.user.starSymbol || null }
      : null,
  })
}
