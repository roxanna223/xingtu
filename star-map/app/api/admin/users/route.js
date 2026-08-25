import { listUsers } from '@/lib/store'
import { requireAdmin } from '@/lib/auth'

// 用户列表(仅管理员)
export async function GET(req) {
  const auth = requireAdmin(req)
  if (!auth.user) return auth.response
  return Response.json({ users: listUsers() })
}
