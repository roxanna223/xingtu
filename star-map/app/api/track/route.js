import { assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'

// 客户端页面浏览埋点(AuthGate 路由变化时上报;管理员不记录)
export async function POST(req) {
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { event = 'page_view', path = '' } = body
  trackReq(req, String(event).slice(0, 40), String(path).slice(0, 200))
  return Response.json({ ok: true })
}
