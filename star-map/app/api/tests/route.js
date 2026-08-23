import { readProfile } from '@/lib/store'

export async function GET() {
  const p = readProfile()
  return Response.json({ tests: p.tests || [] })
}
