import { readProfile, writeProfile } from '@/lib/store'
import { cohortFor } from '@/lib/cohort'

export async function POST(req) {
  const body = await req.json()
  const { birthYearMonth, careerStage, worries = [] } = body || {}
  if (!birthYearMonth) return Response.json({ error: 'birthYearMonth 必填' }, { status: 400 })

  const p = readProfile()
  p.user.cohort = cohortFor(birthYearMonth)
  p.user.careerStage = careerStage || ''
  const t = new Date().toISOString().slice(0, 10)
  for (const w of (Array.isArray(worries) ? worries : []).slice(0, 3)) {
    if (w && String(w).trim()) {
      p.topics.push({
        id: 't' + Math.random().toString(36).slice(2, 8),
        name: String(w).trim().slice(0, 20),
        domain: '自我',
        emotion: '迷茫',
        polarity: -0.4,
        firstSeen: t,
        lastActive: t,
        freq: 1,
        quotes: [String(w).trim().slice(0, 40)],
      })
    }
  }
  writeProfile(p)
  return Response.json({ ok: true, cohort: p.user.cohort })
}
