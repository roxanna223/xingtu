// 目标系统 v1（路线图 P2 提前落地，2026-08-27）
// 目标数据模型：goal = { id, title, summary, createdAt, status: active|archived|done,
//   steps: [{ step, metric, status: todo|done, doneAt }],
//   progress: [{ date, source: chat|record|manual|create, type, stepIndex, note }],
//   lastCheckin }
// 核心链路：定目标(goalBreak Skill) → 自动创建 → 记录/聊天内容自动同步进度(LLM 判定 + 规则兜底)
//          → /goals 计划页展示量化路径轨迹 → 小星开场主动提醒
// 量化口径：完成度 = done 步骤数 / 总步骤数；停滞天数 = 今天 - lastCheckin

import { callLLM, parseJson, goalTarget } from './engine.js'
import { goalSyncMessages, bonusTaskMessages } from './prompts.js'

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
      // 维度③记录感：journal=需要主观输入（记录/写下/复盘类），checkin=一键打卡
      type: s.type === 'journal' || /记录|写下|复盘|总结|整理/.test(s.step) ? 'journal' : 'checkin',
      options: Array.isArray(s.options) ? s.options.slice(0, 4).map((o) => String(o).slice(0, 12)) : [],
      logs: [],
      streakAwarded: [],
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
    // 维度④激励：积分账户 + 每日彩蛋任务
    points: 0,
    pointsLedger: [],
    dailyBonus: null,
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

/* ---------------- 维度②可行性 + 维度③记录感：每日打卡/记录 ---------------- */

/** 从 metric 提取所需打卡次数（取最后一个数字，如"连续 3 天执行"→3；"完成 1 次"→1；默认 1） */
export function requiredCount(metric) {
  const m = String(metric || '').match(/\d+/g)
  return m && m.length ? Number(m[m.length - 1]) : 1
}

/** 连续打卡天数（logs 按日期去重，连续到今天的长度） */
export function stepStreak(step) {
  const days = [...new Set((step.logs || []).map((l) => l.date))].sort()
  if (!days.length) return 0
  const today = nowDay()
  if (days.at(-1) !== today) return 0
  let n = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const expect = new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
    if (days[i] === expect) n++
    else break
  }
  return n
}

/**
 * 每日打卡/记录（目标系统 v2 核心交互）：
 * - journal 型必须带主观内容（快捷选项或自由输入），checkin 型可一键；
 * - 同一步骤同一天只能打一次卡；
 * - 打卡 +5 分，journal 记录 +10 分；连续 3/7/14 天各加一次加成（+5/+10/+20）；
 * - 打卡天数达到 metric 要求的次数 → 步骤自动完成（+30 分）。
 */
export function stepRecord(profile, { goalId, stepIndex, text }) {
  const goal = (profile.goals || []).find((g) => g.id === goalId)
  if (!goal || goal.status !== 'active') return { error: '目标不存在或已结束' }
  const step = goal.steps[stepIndex]
  if (!step || step.status !== 'todo') return { error: '该步骤不存在或已完成' }
  const t = String(text || '').trim().slice(0, 300)
  if (step.type === 'journal' && !t) return { error: '这一步需要记录点内容（可点快捷选项或自己写）' }
  const today = nowDay()
  step.logs = step.logs || []
  if (step.logs.some((l) => l.date === today)) return { error: '今天已经打过卡了，明天再来' }

  const base = step.type === 'journal' ? 10 : 5
  step.logs.push({ date: today, text: t || (step.type === 'journal' ? '完成记录' : '打卡'), points: base })
  addPoints(goal, base, step.type === 'journal' ? 'journal' : 'checkin', `${step.step.slice(0, 16)}${t ? '：' + t.slice(0, 20) : ''}`)

  // 连续打卡加成（每档只发一次）
  const streak = stepStreak(step)
  const awardMap = { 3: 5, 7: 10, 14: 20 }
  step.streakAwarded = step.streakAwarded || []
  for (const [n, pts] of Object.entries(awardMap)) {
    if (streak >= Number(n) && !step.streakAwarded.includes(Number(n))) {
      step.streakAwarded.push(Number(n))
      addPoints(goal, pts, 'streak', `连续 ${n} 天打卡加成`)
    }
  }

  pushProgress(goal, { date: today, source: 'manual', type: step.type === 'journal' ? 'journal' : 'checkin', stepIndex, note: t || '打卡' })
  goal.lastCheckin = today

  // 维度②可行性：打卡天数达标 → 步骤自动完成
  const days = new Set((step.logs || []).map((l) => l.date)).size
  if (days >= requiredCount(step.metric)) {
    step.status = 'done'
    step.doneAt = today
    addPoints(goal, 30, 'step_done', `完成步骤：${step.step.slice(0, 16)}`)
    pushProgress(goal, { date: today, source: 'manual', type: 'step_done', stepIndex, note: '打卡达标自动完成' })
    if (goal.steps.every((s) => s.status === 'done')) {
      goal.status = 'done'
      addPoints(goal, 100, 'goal_done', `目标「${goal.title}」达成`)
      pushProgress(goal, { date: today, source: 'manual', type: 'goal_done', stepIndex: null, note: '全部步骤完成 🎉' })
    }
  }
  return { ok: true, goal, step, streak }
}

/* ---------------- 维度④激励：积分 + 每日彩蛋任务 ---------------- */

export function addPoints(goal, delta, source, note = '') {
  goal.points = (goal.points || 0) + delta
  goal.pointsLedger = goal.pointsLedger || []
  goal.pointsLedger.push({ date: nowDay(), source, delta, note: String(note).slice(0, 40) })
  if (goal.pointsLedger.length > 100) goal.pointsLedger = goal.pointsLedger.slice(-100)
}

/** 等级：0 起步 → 50 铜星 → 150 银星 → 300 金星 */
export function levelOf(points) {
  const p = points || 0
  if (p >= 300) return { name: '金星', next: null }
  if (p >= 150) return { name: '银星', next: 300 }
  if (p >= 50) return { name: '铜星', next: 150 }
  return { name: '起步', next: 50 }
}

/**
 * 每日彩蛋任务：每天 0 点后为每个活跃目标懒生成一条个性化小任务（LLM 生成 + Mock 模板兜底）。
 * 低门槛、一天内可完成、和主线步骤互补——给"每天一样的计划"增加新鲜感和额外积分。
 */
export async function ensureDailyBonus(profile, goal) {
  const today = nowDay()
  if (goal.dailyBonus && goal.dailyBonus.date === today) return goal.dailyBonus
  let bonus = null
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const raw = await callLLM(bonusTaskMessages(goal))
      const parsed = parseJson(raw)
      if (parsed?.task) {
        bonus = {
          task: String(parsed.task).slice(0, 60),
          points: [10, 15, 20].includes(Number(parsed.points)) ? Number(parsed.points) : 15,
          flavor: String(parsed.flavor || '').slice(0, 30),
        }
      }
    } catch (e) {
      console.warn('[goals] 彩蛋任务生成失败，降级 Mock：', e.message)
    }
  }
  if (!bonus) bonus = mockBonusTask(goal)
  goal.dailyBonus = { date: today, ...bonus, doneAt: null }
  return goal.dailyBonus
}

/** Mock 模板：按目标标题关键词给固定小任务池，按日期轮换，保证每天不同 */
function mockBonusTask(goal) {
  const t = goal.title || ''
  const pool = /减肥|瘦|体重|身材/.test(t)
    ? ['今天选一种从没吃过的蔬菜', '饭后散步 15 分钟，不坐电梯改走楼梯', '今天戒掉一杯含糖饮料', '对镜拍一张今天的照片，存给自己']
    : /熬夜|睡|作息|早睡/.test(t)
      ? ['今晚比昨天早 10 分钟放下手机', '把卧室灯光调暗一小时再睡', '睡前写一句"明天想做的第一件事"', '今天下午 4 点后不碰咖啡和奶茶']
      : /学习|读书|英语|技能|转行|面试|求职|秋招/.test(t)
        ? ['今天投出/整理 1 个岗位并记录', '读 10 页书并写下 3 句话收获', '给一个前辈/同行发一条请教消息', '整理一次自己的作品/简历亮点清单']
        : ['今天完成一件拖延了 3 天以上的小事', '给自己留 20 分钟完全放空', '记录今天最有成就感的一个瞬间', '把目标读一遍，并写下此刻的进度感']
  const hash = new Date().getDate() + goal.title.length
  const task = pool[hash % pool.length]
  return { task, points: 15, flavor: '今日彩蛋' }
}

export function completeBonus(profile, { goalId }) {
  const goal = (profile.goals || []).find((g) => g.id === goalId)
  if (!goal || goal.status === 'archived') return { error: '目标不存在' }
  const today = nowDay()
  if (!goal.dailyBonus || goal.dailyBonus.date !== today) return { error: '今天的彩蛋任务还没生成' }
  if (goal.dailyBonus.doneAt) return { error: '今天已经领过奖励了' }
  goal.dailyBonus.doneAt = nowDay()
  addPoints(goal, goal.dailyBonus.points, 'bonus', `彩蛋：${goal.dailyBonus.task.slice(0, 24)}`)
  pushProgress(goal, { date: today, source: 'manual', type: 'bonus', stepIndex: null, note: `彩蛋完成 +${goal.dailyBonus.points}：${goal.dailyBonus.task.slice(0, 24)}` })
  goal.lastCheckin = today
  return { ok: true, goal }
}

/** 补记/修改今天的备注（客观任务完成后想补一句，或修正主观记录内容）；不加分不重复计算 */
export function stepNote(profile, { goalId, stepIndex, text }) {
  const goal = (profile.goals || []).find((g) => g.id === goalId)
  if (!goal) return { error: '目标不存在' }
  const step = goal.steps[stepIndex]
  if (!step) return { error: '步骤不存在' }
  const today = nowDay()
  step.logs = step.logs || []
  const log = step.logs.find((l) => l.date === today)
  if (!log) return { error: '今天还没有打卡，先完成再补备注' }
  const t = String(text || '').trim().slice(0, 300)
  if (!t) return { error: '备注内容为空' }
  log.text = t
  return { ok: true, goal }
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
    addPoints(goal, 30, 'step_done', `完成步骤：${step.step.slice(0, 16)}`)
    pushProgress(goal, { date: today, source: 'manual', type: 'step_done', stepIndex, note: step.step.slice(0, 20) })
  } else {
    step.status = 'todo'
    step.doneAt = null
    pushProgress(goal, { date: today, source: 'manual', type: 'step_reopen', stepIndex, note: '重新打开这一步' })
  }
  goal.lastCheckin = today
  if (goal.steps.length && goal.steps.every((s) => s.status === 'done')) {
    if (goal.status !== 'done') {
      goal.status = 'done'
      addPoints(goal, 100, 'goal_done', `目标「${goal.title}」达成`)
      pushProgress(goal, { date: today, source: 'manual', type: 'goal_done', stepIndex: null, note: '全部步骤完成 🎉' })
    }
  } else if (goal.status === 'done') goal.status = 'active'
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
      const level = levelOf(g.points)
      const bonusToday = g.dailyBonus && g.dailyBonus.date === nowDay() && !g.dailyBonus.doneAt ? g.dailyBonus : null
      return {
        id: g.id,
        title: g.title,
        doneSteps,
        totalSteps: g.steps.length,
        nextStep: next ? next.step : null,
        nextMetric: next ? next.metric : null,
        nextType: next ? next.type : null,
        idleDays: daysBetween(g.lastCheckin, nowDay()),
        points: g.points || 0,
        level: level.name,
        bonusTask: bonusToday ? bonusToday.task : null,
        bonusPoints: bonusToday ? bonusToday.points : null,
        recentNotes: (g.progress || []).slice(-2).map((p) => `${p.date} ${p.type === 'step_done' ? '完成一步' : p.type === 'mention' ? '有进展' : p.type === 'bonus' ? '彩蛋完成' : p.type}`),
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
