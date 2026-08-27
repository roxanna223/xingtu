import { readProfile, writeProfile, readDays, withStoreLock } from '@/lib/store'
import { applyAdoption } from '@/lib/engine'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'

const RANGES = ['week', 'month', 'quarter', 'year']

// P0 建议采纳闭环（指路验证 Q6）：用户对报告建议标记「已做/没做」。
// 存证三处：adoptions（含极性快照）、主题 actionState、adaptLog；同一份报告重复标记 = 更新。
export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })

  const range = String(body.range || 'day')
  const date = body.date ? String(body.date).slice(0, 10) : ''
  const adopted = body.adopted === true
  if (range !== 'day' && !RANGES.includes(range)) {
    return Response.json({ error: 'range 不合法' }, { status: 400 })
  }

  try {
    const out = await withStoreLock(() => {
      const p = readProfile(userId)
      const days = readDays(userId)
      const lastDay = days.at(-1)?.date || ''

      const report = range === 'day' ? (date ? p.reports?.[date] : p.lastReport) : p.periodReports?.[range]
      if (!report || !report.suggestion) {
        return { error: '这份报告没有建议，无需标记', code: 400 }
      }
      // 报告键：日报告按记录日期（重生成不换键）；周期报告按周期起点（稳定）
      const reportKey = range === 'day' ? `day:${date || lastDay}` : `${range}:${report.start || ''}`
      const saved = applyAdoption(p, {
        reportKey,
        suggestion: report.suggestion,
        adopted,
        date: new Date().toISOString().slice(0, 10),
        reportDay: range === 'day' ? date || lastDay : null,
        suggestionTopicName: report.suggestionTopic,
      })
      writeProfile(userId, p)
      return { error: null, saved }
    })
    if (out.error) return Response.json({ error: out.error }, { status: out.code })
    trackReq(req, 'adoption', '/api/adoption', { adopted: out.saved.adopted, reportKey: out.saved.reportKey })
    return Response.json({
      ok: true,
      adopted: out.saved.adopted,
      reportKey: out.saved.reportKey,
      topicName: out.saved.topicName,
      polarityAtAdoption: out.saved.polarityAtAdoption,
    })
  } catch (e) {
    console.error('[adoption] 标记失败：', e)
    return Response.json({ error: '标记失败，请稍后重试' }, { status: 500 })
  }
}
