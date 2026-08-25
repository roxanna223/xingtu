import { readProfile, writeProfile } from '@/lib/store'
import { applyFeedback } from '@/lib/engine'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'

export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { helpful, comment, observation, ok } = body
  trackReq(req, 'feedback', '/api/feedback')
  const p = readProfile(userId)

  // 观察反馈（"这条观察对吗"）——存证供自迭代，不即时改动报告
  if (observation) {
    p.feedbackLog.push({
      date: new Date().toISOString().slice(0, 10),
      type: 'observation',
      text: String(observation).slice(0, 120),
      ok: !!ok,
    })
    writeProfile(userId, p)
    return Response.json({ ok: true, adjusted: [] })
  }

  const adjusted = applyFeedback(p, { helpful: !!helpful, comment: comment || '' })
  writeProfile(userId, p)
  return Response.json({ ok: true, adjusted })
}
