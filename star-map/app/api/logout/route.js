import { clearSessionCookie, getSessionUser } from '@/lib/auth'
import { trackReq } from '@/lib/track'

// 登出 = 结束会话(清单 A2):清 cookie,不触碰画像数据
export async function POST(req) {
  if (getSessionUser(req)) trackReq(req, 'logout', '/api/logout')
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() },
  })
}
