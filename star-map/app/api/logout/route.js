import { readProfile, writeProfile } from '@/lib/store'

export async function POST() {
  const p = readProfile()
  p.user.username = ''
  writeProfile(p)
  return Response.json({ ok: true })
}
