// 目标系统 v1（路线图 P2 提前落地，2026-08-27）
// 目标数据模型：goal = { id, title, summary, createdAt, status: active|archived|done,
//   steps: [{ step, metric, status: todo|done, doneAt }],
//   progress: [{ date, source: chat|record|manual|create, type, stepIndex, note }],
//   lastCheckin }
// 核心链路：定目标(goalBreak Skill) → 自动创建 → 记录/聊天内容自动同步进度(LLM 判定 + 规则兜底)
//          → /goals 计划页展示量化路径轨迹 → 小星开场主动提醒
// 量化口径：完成度 = done 步骤数 / 总步骤数；停滞天数 = 今天 - lastCheckin

import { callLLM, parseJson, goalTarget } from './engine.js'
import { goalSyncMessages } from './prompts.js'

const nowDay = () => new Date().toISOString().slice(0, 10)

/* ---------------- 创建 ---------------- */

/**
 * 从 goalBreak Skill 的输出创建正式目标（自动加入「计划」栏目）。
 * 标题优先级：skill.goal（LLM 提炼）→ 文本推导（goalTarget）。
 */
export function createGoalFromSkill(profile, skill, fallbackText = '') {
  const title = String(skill?.goal || goalTarget(fallbackText) || '新目标').slice(0, 20)
  const steps = (skill?.steps || [])
    .slice(0, 8)
    .map((s) => ({
      step: String(s.step || '').slice(0, 60),
      metric: String(s.metric || '').slice(0, 40),
      status: 'todo',
      doneAt: null,
    }))
  if (!steps.length) return null
  const goal = {
    id: 'g' + Math.random().toString(36).slice(2, 8),
    title,
    summary: String(skill?.summary || '').slice(0, 60),
    createdAt: nowDay(),
    status: 'active',
    steps,
    progress: [{ date: nowDay(), source: 'create', type: 'created', stepIndex: null, note: `拆解为 ${steps.length} 步` }],
    lastCheckin: nowDay(),
  }
  profile.goals = profile.goals || []
  profile.goals.unshift(goal)
  return goal
}

/* ---------------- 文本 → 目标进度同步（双模） ---------------- */

/**
 * 用一段文本（当日记录 / 小星对话）同步目标进度。
 * LLM 判定「文本是否体现某步骤已完成 / 与目标相关」；无 Key 时降级规则版（保守，只记相关）。
 * 直接修改传入的 profile 对象，返回本次产生的更新列表。调用方负责加锁与落盘。
 */
export async function syncGoalsWithText(profile, text, source = 'record') {
  const active = (profile.goals || []).filter((g) => g.status === 'active')
  const t = String(text || '').trim()
  if (!active.length || !t) return { updates: [] }

  let updates = []
  const hasKey = !!process.env.DEEPSEEK_API_KEY
  if (hasKey) {
    try {
      const raw = await callLLM(goalSyncMessages(active, t))
      const parsed = parseJson(raw)
      if (parsed && Array.isArray(parsed.updates)) {
        updates = parsed.updates
          .filter((u) => u && active.some((g) => g.id === u.goalId))
          .map((u) => ({
            goalId: String(u.goalId),
            stepIndex: Number.isInteger(u.stepIndex) ? u.stepIndex : null,
            action: u.action === 'done' ? 'done' : 'related',
            note: String(u.note || '').slice(0, 30),
          }))
      }
    } catch (e) {
      console.warn('[goals] LLM 目标同步失败，降级规则：', e.message)
      updates = []
    }
  }
  if (!updates.length && !hasKey) updates = mockGoalSync(active, t)
  // LLM 判定为空也补一次规则兜底（只记"相关"，不误标完成）
  if (!updates.length && hasKey) updates = mockGoalSync(active, t, { mentionOnly: true })

  const applied = []
  const today = nowDay()
  for (const u of updates) {
    const goal = (profile.goals || []).find((g) => g.id === u.goalId)
    if (!goal || goal.status !== 'active') continue
    const step = u.stepIndex != null ? goal.steps[u.stepIndex] : null
    if (u.action === 'done' && step && step.status === 'todo') {
      step.status = 'done'
      step.doneAt = today
      pushProgress(goal, { date: today, source, type: 'step_done', stepIndex: u.stepIndex, note: u.note || step.step.slice(0, 20) })
      applied.push({ goalId: goal.id, goalTitle: goal.title, stepIndex: u.stepIndex, action: 'done' })
    } else if (u.action === 'done' && !step) {
      // 无具体步骤但明确完成信号：记一次目标级进展
      pushProgress(goal, { date: today, source, type: 'mention', stepIndex: null, note: u.note || '目标有进展' })
      applied.push({ goalId: goal.id, goalTitle: goal.title, stepIndex: null, action: 'related' })
    } else {
      // 相关提及：同一天同来源同步骤只记一次，避免刷屏
      const dup = (goal.progress || []).some((p) => p.date === today && p.source === source && p.type === 'mention' && p.stepIndex === u.stepIndex)
      if (!dup) {
        pushProgress(goal, { date: today, source, type: 'mention', stepIndex: u.stepIndex, note: u.note || '' })
        applied.push({ goalId: goal.id, goalTitle: goal.title, stepIndex: u.stepIndex, action: 'related' })
      }
    }
    goal.lastCheckin = today
    // 全部步骤完成 → 目标完成（保留展示，不自动归档）
    if (goal.steps.length && goal.steps.every((s) => s.status === 'done')) goal.status = 'done'
  }
  return { updates: applied }
}

/** 规则版兜底：标题/步骤关键词命中 → 记"相关"；明确的完成信号 + 关键词 → 才记"完成" */
function mockGoalSync(activeGoals, text, { mentionOnly = false } = {}) {
  const out = []
  const DONE_RE = /完成|做到|打卡|搞定|坚持了|做到了|达标|已经|成功了|做到了/
  const KW_RE = /完成|连续|记录|写|执行|坚持|保持|达标|天|次|条|周|小时|分钟|同一时间|满|个|件/g
  for (const g of activeGoals) {
    const titleHit = text.includes(g.title.slice(0, 6)) || (g.title.length > 2 && text.includes(g.title))
    g.steps.forEach((s, i) => {
      if (s.status !== 'todo') return
      const kw = String(s.metric || '').replace(KW_RE, '').trim()
      if (!kw || kw.length < 2) return
      const kwHit = text.includes(kw) || (titleHit && DONE_RE.test(text))
      if (!kwHit) return
      const done = !mentionOnly && DONE_RE.test(text)
      out.push({ goalId: g.id, stepIndex: i, action: done ? 'done' : 'related', note: done ? `完成：${s.metric}` : '提到相关进展' })
    })
  }
  return out
}

function pushProgress(goal, ev) {
  goal.progress = goal.progress || []
  goal.progress.push(ev)
  if (goal.progress.length > 80) goal.progress = goal.progress.slice(-80)
}

/* ---------------- 手动操作 ---------------- */

export function toggleGoalStep(profile, { goalId, stepIndex, done }) {
  const goal = (profile.goals || []).find((g) => g.id === goalId)
  if (!goal) return { error: '目标不存在' }
  const step = goal.steps[stepIndex]
  if (!step) return { error: '步骤不存在' }
  const today = nowDay()
  if (done) {
    if (step.status === 'done') return { error: '该步骤已完成' }
    step.status = 'done'
    step.doneAt = today
    pushProgress(goal, { date: today, source: 'manual', type: 'step_done', stepIndex, note: step.step.slice(0, 20) })
  } else {
    step.status = 'todo'
    step.doneAt = null
    pushProgress(goal, { date: today, source: 'manual', type: 'step_reopen', stepIndex, note: '重新打开这一步' })
  }
  goal.lastCheckin = today
  if (goal.steps.length && goal.steps.every((s) => s.status === 'done')) goal.status = 'done'
  else if (goal.status === 'done') goal.status = 'active'
  return { ok: true, goal }
}

export function archiveGoal(profile, goalId) {
  const goal = (profile.goals || []).find((g) => g.id === goalId)
  if (!goal) return { error: '目标不存在' }
  goal.status = 'archived'
  pushProgress(goal, { date: nowDay(), source: 'manual', type: 'archived', stepIndex: null, note: '归档' })
  return { ok: true, goal }
}

export function deleteGoal(profile, goalId) {
  profile.goals = (profile.goals || []).filter((g) => g.id !== goalId)
  return { ok: true }
}

/* ---------------- 摘要与提醒 ---------------- */

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

/** 活跃目标摘要（注入小星/报告提示词用；控制体积只给关键字段） */
export function goalsSummaryForPrompt(profile) {
  return (profile.goals || [])
    .filter((g) => g.status === 'active')
    .slice(0, 5)
    .map((g) => {
      const doneSteps = g.steps.filter((s) => s.status === 'done').length
      const next = g.steps.find((s) => s.status === 'todo')
      return {
        id: g.id,
        title: g.title,
        doneSteps,
        totalSteps: g.steps.length,
        nextStep: next ? next.step : null,
        nextMetric: next ? next.metric : null,
        idleDays: daysBetween(g.lastCheckin, nowDay()),
        recentNotes: (g.progress || []).slice(-2).map((p) => `${p.date} ${p.type === 'step_done' ? '完成一步' : p.type === 'mention' ? '有进展' : p.type}`),
      }
    })
}

/** 开场提醒文案（Mock 兜底用；LLM 模式由 starMessages 提示词生成） */
export function goalsReminderLine(profile) {
  const list = goalsSummaryForPrompt(profile)
  if (!list.length) return ''
  const doing = list.find((g) => g.doneSteps > 0 && g.nextStep)
  const fresh = list.find((g) => g.doneSteps === 0)
  const idle = list.find((g) => g.idleDays >= 3)
  if (doing) return `你的目标「${doing.title}」已完成 ${doing.doneSteps}/${doing.totalSteps}，下一步可以试试：${doing.nextStep}。`
  if (idle) return `你的目标「${idle.title}」有 ${idle.idleDays} 天没更新了，今天想为它做点什么吗？`
  if (fresh) return `你的目标「${fresh.title}」已经拆好 ${fresh.totalSteps} 步，随时可以从第 1 步开始：${fresh.nextStep}。`
  return ''
}
