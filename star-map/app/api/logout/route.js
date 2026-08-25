import { clearSessionCookie, getSessionToken, revokeSessionToken, reqIsHttps } from '@/lib/auth'
import { trackReq } from '@/lib/track'

// 登出 = 结束会话(清单 A2):吊销 token(黑名单,立即失效)+ 清 cookie,不触碰画像数据
export async function POST(req) {
  const token = getSessionToken(req)
  if (token) {
    trackReq(req, 'logout', '/api/logout')
    revokeSessionToken(token)
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie(reqIsHttps(req)) },
  })
}
