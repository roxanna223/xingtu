import { readProfile, readDays, readChats, listStreamDays, touchUserActive } from '@/lib/store'
import { pendingChatCount, consumePendingChats } from '@/lib/chatStore'
import { requireAuth } from '@/lib/auth'
import { debugAllowed } from '@/app/api/debug/route'

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
  // 有内容的天数 = 日记天数 ∪ 事件流天数（聊天/日记段落都算"记录"）——
  // 首图进度/主页 DAY 计数用这个口径：只聊不写日记也算陪星图走过一天
  const contentDays = [...new Set([...days.map((d) => d.date), ...listStreamDays(userId)])].sort()

  // P0-1：兜底触发——待抽取对话攒够 3 条时后台并入画像（不阻塞状态响应）
  if (!p.generating && pendingChatCount(readChats(userId)) >= 3) {
    consumePendingChats(userId).catch(() => {})
  }

  return Response.json({
    loggedIn: true,
    user: {
      username: auth.user.username,
      role: auth.user.role,
    },
    onboarded: !!(auth.user.cohort?.birthYearMonth),
    dayCount: contentDays.length,
    // 主页"我在哪"：最近 3 天情绪轨迹（真实数据，来自画像情绪序列）
    moodTrail: (p.emotionSeries || []).slice(-3).map((s) => ({ date: s.date, emotion: s.topEmotion || '' })),
    hasKey: !!process.env.DEEPSEEK_API_KEY,
    lastDate: contentDays.at(-1) || days.at(-1)?.date || null,
    debugAvailable: debugAllowed(auth.user),
  })
}
