import { createInvites, listInvites } from '@/lib/store'
import { requireAdmin, assertSameOrigin, readJsonBody } from '@/lib/auth'

// 邀请码管理(仅管理员;管理员操作不写埋点)
export async function GET(req) {
  const auth = requireAdmin(req)
  if (!auth.user) return auth.response
  return Response.json({ invites: listInvites() })
}

export async function POST(req) {
  const auth = requireAdmin(req)
  if (!auth.user) return auth.response
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { count = 1, note = '', ttlDays = null } = body
  const n = Math.min(20, Math.max(1, Number(count) || 1))
  const ttl = ttlDays ? Math.min(365, Math.max(1, Number(ttlDays) || 0)) : null
  const codes = createInvites(auth.user.id, n, note, ttl)
  return Response.json({ ok: true, codes, invites: listInvites() })
}
