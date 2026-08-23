import { readProfile, readDays } from '@/lib/store'

export async function GET() {
  const p = readProfile()
  const days = readDays()
  return Response.json({
    loggedIn: !!p.user?.username,
    user: p.user?.username
      ? { username: p.user.username, starSign: p.user.starSign || null, starSymbol: p.user.starSymbol || null }
      : null,
    onboarded: !!(p.user?.cohort?.birthYearMonth),
    dayCount: days.length,
    hasKey: !!process.env.DEEPSEEK_API_KEY,
    lastDate: days.at(-1)?.date || null,
  })
}
