import { readProfile, readDays } from '@/lib/store'
import { emotionCountsFromTrack, mixEmotionColors } from '@/lib/colors'
import { requireAuth } from '@/lib/auth'

// 报告历史清单（轻量：不调 LLM，心情色由轨迹计算，秒回）
export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  const p = readProfile(userId)
  const days = readDays(userId)
  const series = p.emotionSeries || []
  const list = days.map((d) => {
    const s = series.find((e) => e.date === d.date)
    return {
      date: d.date,
      moodColor: mixEmotionColors(emotionCountsFromTrack(d.q2 || '')),
      topEmotion: s?.topEmotion || '',
      q1: d.q1 || '',
    }
  })
  return Response.json({ reports: list })
}
