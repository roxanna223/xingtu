import { readProfile, writeProfile } from '@/lib/store'
import { applyFeedback } from '@/lib/engine'

export async function POST(req) {
  const body = await req.json()
  const { helpful, comment, observation, ok } = body || {}
  const p = readProfile()

  // 观察反馈（"这条观察对吗"）——存证供自迭代，不即时改动报告
  if (observation) {
    p.feedbackLog.push({
      date: new Date().toISOString().slice(0, 10),
      type: 'observation',
      text: String(observation).slice(0, 120),
      ok: !!ok,
    })
    writeProfile(p)
    return Response.json({ ok: true, adjusted: [] })
  }

  const adjusted = applyFeedback(p, { helpful: !!helpful, comment: comment || '' })
  writeProfile(p)
  return Response.json({ ok: true, adjusted })
}
