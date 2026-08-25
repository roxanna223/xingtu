import { readProfile } from '@/lib/store'
import { requireAuth } from '@/lib/auth'

export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  const p = readProfile(userId)
  return Response.json({ tests: p.tests || [] })
}
