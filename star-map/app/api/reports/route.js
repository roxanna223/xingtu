import { readProfile, readDays, listStreamDays } from '@/lib/store'
import { emotionCountsFromTrack, mixEmotionColors } from '@/lib/colors'
import { requireAuth } from '@/lib/auth'

// 报告历史清单（轻量：不调 LLM，心情色由轨迹计算，秒回）
// 日期 = days（日记镜像）+ stream（仅有对话的日子）的并集
export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  const p = readProfile(userId)
  const days = readDays(userId)
  const streamDays = listStreamDays(userId)
  const allDates = [...new Set([...days.map((d) => d.date), ...streamDays])].sort()
  const series = p.emotionSeries || []
  const list = allDates.map((date) => {
    const d = days.find((x) => x.date === date)
    const s = series.find((e) => e.date === date)
    return {
      date,
      moodColor: mixEmotionColors(emotionCountsFromTrack(d?.q2 || '')),
      topEmotion: s?.topEmotion || '',
      q1: d?.q1 || '（对话日）',
    }
  })
  return Response.json({ reports: list })
}
