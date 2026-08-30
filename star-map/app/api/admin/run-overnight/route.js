import { requireAdmin } from '@/lib/auth'
import { readJsonBody } from '@/lib/auth'
import { runOvernightAll, yesterdayKey } from '@/lib/overnight'
import { trackReq } from '@/lib/track'

// 手动触发 6:00 夜间作业（仅管理员）：补跑/验证用。默认处理昨天（6:00 划日）。
// body: { day?: 'YYYY-MM-DD', force?: true }
export async function POST(req) {
  const auth = requireAdmin(req)
  if (!auth.user) return auth.response
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const day = body.day ? String(body.day).slice(0, 10) : yesterdayKey()
  const force = body.force === true
  const out = await runOvernightAll({ targetDay: day, force })
  trackReq(req, 'admin_overnight', '/api/admin/run-overnight', { day, force })
  return Response.json({ ok: true, ...out })
}
