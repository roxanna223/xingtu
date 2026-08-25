import { readProfile, readDays, readChats } from '@/lib/store'
import { pendingChatCount, consumePendingChats } from '@/lib/chatStore'

export async function GET() {
  const p = readProfile()
  const days = readDays()

  // P0-1：兜底触发——待抽取对话攒够 3 条时后台并入画像（不阻塞状态响应）
  if (!p.generating && pendingChatCount(readChats()) >= 3) {
    consumePendingChats().catch(() => {})
  }

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
