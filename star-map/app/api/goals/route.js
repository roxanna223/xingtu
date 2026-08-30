import { readProfile, writeProfile, withStoreLock } from '@/lib/store'
import { buildProfileSummary, generateGoalBreak } from '@/lib/engine'
import {
  createGoalFromSkill,
  toggleGoalStep,
  archiveGoal,
  deleteGoal,
  goalsSummaryForPrompt,
  stepRecord,
  stepNote,
  normalizeGoals,
  todayStepFor,
} from '@/lib/goals'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'

// 目标系统 v2（计划栏目 + 每日打卡/记录）：
// GET  返回目标列表 + 活跃目标摘要
// POST {action:'create', text}                       手动创建：goalBreak 拆解 + 自动落计划栏目
//      {action:'stepRecord', goalId, stepIndex, text} 每日打卡/记录（journal 需内容，checkin 可一键）
//      {action:'toggleStep', goalId, stepIndex, done} 手动完成/重开步骤
//      {action:'archive'|'delete', goalId}            归档/删除
export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  try {
    const data = await withStoreLock(async () => {
      const p = normalizeGoals(readProfile(userId))
      return { goals: p.goals || [], summary: goalsSummaryForPrompt(p), todayStep: todayStepFor(p) }
    })
    return Response.json(data)
  } catch (e) {
    console.error('[goals] 列表失败：', e)
    return Response.json({ goals: [], summary: [] })
  }
}

export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { action = '', text = '', goalId = '', stepIndex = 0, subIndex = null, done = true } = body

  try {
    if (action === 'create') {
      if (!String(text).trim()) return Response.json({ error: '请描述你的目标' }, { status: 400 })
      const goal = await withStoreLock(async () => {
        const p = readProfile(userId)
        const summary = buildProfileSummary(p)
        const out = await generateGoalBreak(String(text).trim().slice(0, 200), summary)
        const g = createGoalFromSkill(p, out.skill, text)
        if (g) writeProfile(userId, p)
        return g
      })
      if (!goal) return Response.json({ error: '目标拆解失败，请换个说法试试' }, { status: 500 })
      trackReq(req, 'goal_create', '/api/goals')
      return Response.json({ ok: true, goal })
    }

    const res = await withStoreLock(async () => {
      const p = normalizeGoals(readProfile(userId))
      let r
      if (action === 'stepRecord') r = await stepRecord(p, { goalId, stepIndex: Number(stepIndex), subIndex: subIndex == null ? null : Number(subIndex), text })
      else if (action === 'stepNote') r = stepNote(p, { goalId, stepIndex: Number(stepIndex), text })
      else if (action === 'toggleStep') r = toggleGoalStep(p, { goalId, stepIndex: Number(stepIndex), done: !!done })
      else if (action === 'archive') r = archiveGoal(p, goalId)
      else if (action === 'delete') r = deleteGoal(p, goalId)
      else return { error: 'action 不合法', code: 400 }
      if (r.error) return { error: r.error, code: 400 }
      writeProfile(userId, p)
      trackReq(req, 'goal_' + action, '/api/goals')
      return { goal: r.goal || null, extra: r.streak != null ? { streak: r.streak } : null }
    })
    if (res.error) return Response.json({ error: res.error }, { status: res.code })
    return Response.json({ ok: true, goal: res.goal, ...(res.extra || {}) })
  } catch (e) {
    console.error('[goals] 操作失败：', e)
    return Response.json({ error: '操作失败，请稍后重试' }, { status: 500 })
  }
}
