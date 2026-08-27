import { statsOverview, statsDaily, skillsOverview } from '@/lib/store'
import { requireAdmin } from '@/lib/auth'

// 数据看板(仅管理员):概览 + 近 7 天 PV/活跃趋势 + 事件分布 + Skill 调度统计
export async function GET(req) {
  const auth = requireAdmin(req)
  if (!auth.user) return auth.response
  const url = new URL(req.url)
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days')) || 7))
  return Response.json({ overview: statsOverview(), daily: statsDaily(days), skills: skillsOverview() })
}
