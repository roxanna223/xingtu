import { readProfile, readDays, readChats, touchUserActive } from '@/lib/store'
import { pendingChatCount, consumePendingChats } from '@/lib/chatStore'
import { requireAuth } from '@/lib/auth'

// 登录态按会话判断(清单 A2 + 方案 15):无有效会话一律返回未登录,不泄漏任何用户数据
export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id

  // 活跃时间限频更新(5 分钟粒度),避免每次轮询都写库
  const last = auth.user.lastActiveAt ? new Date(auth.user.lastActiveAt).getTime() : 0
  if (Date.now() - last > 5 * 60 * 1000) touchUserActive(userId)
  const p = readProfile(userId)
  const days = readDays(userId)

  // P0-1：兜底触发——待抽取对话攒够 3 条时后台并入画像（不阻塞状态响应）
  if (!p.generating && pendingChatCount(readChats(userId)) >= 3) {
    consumePendingChats(userId).catch(() => {})
  }

  return Response.json({
    loggedIn: true,
    user: {
      username: auth.user.username,
      starSign: auth.user.starSign || null,
      starSymbol: auth.user.starSymbol || null,
      role: auth.user.role,
    },
    onboarded: !!(auth.user.cohort?.birthYearMonth),
    dayCount: days.length,
    hasKey: !!process.env.DEEPSEEK_API_KEY,
    lastDate: days.at(-1)?.date || null,
  })
}
