import { findUserByUsername, deleteUserById, readDays, readChats, trackEvent } from '@/lib/store'
import { requireAuth, verifyPassword, clearSessionCookie, reqIsHttps, getSessionToken, revokeSessionToken, assertSameOrigin, readJsonBody } from '@/lib/auth'

// 账号管理:信息查询 + 注销(方案 docs/15 §3)
export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const days = readDays(auth.user.id)
  const chats = readChats(auth.user.id)
  return Response.json({
    user: {
      username: auth.user.username,
      starSign: auth.user.starSign || null,
      role: auth.user.role,
      createdAt: auth.user.createdAt,
      lastActiveAt: auth.user.lastActiveAt,
    },
    dayCount: days.length,
    chatCount: chats.length,
  })
}

// 注销账号:需密码确认(防 CSRF/误操作);删除 users 行后外键级联清空画像/日记/对话,
// 埋点事件 user_id 置 NULL 匿名保留(不含内容),邀请码记录保留
export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { action = '', password = '' } = body

  if (action !== 'delete') return Response.json({ error: '未知操作' }, { status: 400 })
  if (!verifyPassword(String(password), auth.user.passwordHash)) {
    return Response.json({ error: '密码不正确，无法注销' }, { status: 401 })
  }

  const username = auth.user.username
  trackEvent(auth.user.id, 'account_deleted', '/api/account', { username })
  deleteUserById(auth.user.id)
  const token = getSessionToken(req)
  if (token) revokeSessionToken(token)

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie(reqIsHttps(req)) },
  })
}
