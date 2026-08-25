import { readProfile, writeProfile } from '@/lib/store'
import { cohortFor } from '@/lib/cohort'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'

export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { birthYearMonth, careerStage, worries = [] } = body
  if (!birthYearMonth) return Response.json({ error: 'birthYearMonth 必填' }, { status: 400 })

  const p = readProfile(userId)
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
  writeProfile(userId, p)
  return Response.json({ ok: true, cohort: p.user.cohort })
}
