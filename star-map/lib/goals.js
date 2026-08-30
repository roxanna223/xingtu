// 目标系统 v1（路线图 P2 提前落地，2026-08-27）
// 目标数据模型：goal = { id, title, summary, createdAt, status: active|archived|done,
//   steps: [{ step, metric, status: todo|done, doneAt }],
//   progress: [{ date, source: chat|record|manual|create, type, stepIndex, note }],
//   lastCheckin }
// 核心链路：定目标(goalBreak Skill) → 自动创建 → 记录/聊天内容自动同步进度(LLM 判定 + 规则兜底)
//          → /goals 计划页展示量化路径轨迹 → 小星开场主动提醒
// 量化口径：完成度 = done 步骤数 / 总步骤数；停滞天数 = 今天 - lastCheckin

import { callLLM, parseJson, goalTarget } from './engine.js'
import { goalSyncMessages, bonusTaskMessages, structuredLogMessages } from './prompts.js'
import { fakeNow, fakeTodayISO } from './clock.js'

const nowDay = () => fakeTodayISO()

/**
 * 类型归一（修复 v1 旧目标无 type 字段被误判为客观的问题）。
 * 判定原则（产品铁律）：客观 = 只回答"是/不是"就能完成量化；主观 = 量化需要具体数据。
 * 启发式兜底：含数据采集动词（记录/写下/复盘/总结/称/量/拍照/整理/感受/吃了什么）→ journal。
 */
export function normalizeGoals(profile) {
  for (const g of profile.goals || []) {
    for (const s of g.steps || []) {
      if (!s.type) {
        s.type = /记录|写下|复盘|总结|称重|称一|测量|拍照|整理|感受|吃了什么|写一篇|写下|总结/.test(s.step) ? 'journal' : 'checkin'
      }
      if (!Array.isArray(s.options)) s.options = []
      if (!Array.isArray(s.logs)) s.logs = []
      if (!Array.isArray(s.streakAwarded)) s.streakAwarded = []
      if (!Array.isArray(s.subItems)) s.subItems = []
      for (const x of s.subItems) {
        if (x.points == null) x.points = 5
        if (x.text == null) x.text = ''
      }
      // 能拆就拆兜底：三餐类步骤确定性拆细分项（不依赖 LLM 是否输出 subItems）
      if (!s.subItems.length && s.type === 'journal') {
        const meals = mealSubItems(s.step)
        if (meals.length) {
          s.subItems = meals.map((m) => ({ name: m, points: 5, doneAt: null, text: '' }))
          if (meals.length >= 2) s.options = [] // options 与细分项二选一，避免重复入口
        }
      }
    }
  }
  return profile
}

/** 三餐类关键词 → 细分项（确定性，能拆就拆铁律的执行兜底） */
function mealSubItems(stepText) {
  const t = String(stepText || '')
  const names = []
  if (/早餐|早饭/.test(t)) names.push('早餐')
  if (/午餐|午饭|中饭/.test(t)) names.push('午餐')
  if (/晚餐|晚饭/.test(t)) names.push('晚餐')
  if (/加餐|下午茶|夜宵/.test(t)) names.push('加餐')
  if (/三餐/.test(t) && !names.length) return ['早餐', '午餐', '晚餐']
  return names
}

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
      // 维度③记录感：journal=需要具体数据（主观），checkin=只答"是/否"即可（客观）——分类铁律见迭代日志
      type: s.type === 'journal' || /记录|写下|复盘|总结|整理|称重|测量/.test(s.step) ? 'journal' : 'checkin',
      options: Array.isArray(s.options) ? s.options.slice(0, 4).map((o) => String(o).slice(0, 12)) : [],
      // 细分项（能拆就拆）：可并列、分别独立完成的子项（如三餐→早/午/晚），每项单独计分
      subItems: (Array.isArray(s.subItems) ? s.subItems : [])
        .slice(0, 6)
        .map((x) => ({
          name: String(x.name || '').slice(0, 10),
          points: Number(x.points) > 0 ? Number(x.points) : 5,
          doneAt: null,
          text: '',
        })),
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
  normalizeGoals(profile)
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
 * 每日打卡/记录（目标系统 v2.2 核心交互）：
 * - 无细分项：journal 需内容 +10 / checkin 一键 +5；同日一次；连续 3/7/14 加成；达标自动完成；
 * - 有细分项（能拆就拆，如三餐→早/午/晚）：可随时单独记录某一项（+该项 points）；
 *   subIndex=null 时走「随手记」——AI 梳理整段内容并自动分发到未完成的细分项（规则兜底）；
 *   今天所有细分项都完成 → 才算"完整记录一天"（计入达标天数/连续天数）。
 */
export async function stepRecord(profile, { goalId, stepIndex, subIndex = null, text }) {
  const goal = (profile.goals || []).find((g) => g.id === goalId)
  if (!goal || goal.status !== 'active') return { error: '目标不存在或已结束' }
  const step = goal.steps[stepIndex]
  if (!step || step.status !== 'todo') return { error: '该步骤不存在或已完成' }
  const t = String(text || '').trim().slice(0, 300)
  const today = nowDay()
  const subs = step.subItems || []

  /* ---------- 有细分项：逐项记录 / 随手记 AI 梳理 ---------- */
  if (subs.length) {
    let applied = []
    if (subIndex != null) {
      const sub = subs[Number(subIndex)]
      if (!sub) return { error: '细分项不存在' }
      if (sub.doneAt === today) return { error: `「${sub.name}」今天已经记过了` }
      if (step.type === 'journal' && !t) return { error: `写一写「${sub.name}」的内容再提交` }
      sub.doneAt = today
      sub.text = t || sub.name
      addPoints(goal, sub.points || 5, 'subitem', `${step.step.slice(0, 12)}·${sub.name}${t ? '：' + t.slice(0, 16) : ''}`)
      applied.push({ subIndex: Number(subIndex), text: t, name: sub.name })
    } else {
      // 随手记：AI 梳理 → 分发到未完成细分项（LLM + 规则兜底）
      if (!t) return { error: '写一写内容再提交（可以一次写完，AI 帮你分）' }
      let items = null
      if (process.env.DEEPSEEK_API_KEY) {
        try {
          const raw = await callLLM(structuredLogMessages(step, t))
          const parsed = parseJson(raw)
          if (parsed && Array.isArray(parsed.items) && parsed.items.length) items = parsed.items
        } catch (e) {
          console.warn('[goals] 随手记梳理失败，降级规则：', e.message)
        }
      }
      if (!items) items = ruleSplitSubItems(step, t)
      // 安全过滤：否定/未发生的内容一律不落档（"晚上还没到"≠晚餐已记录）
      items = items.filter((it) => it && !isNegatedText(String(it.text || '')))
      for (const it of items) {
        const sub = subs[Number(it.subIndex)]
        if (!sub || sub.doneAt === today) continue
        sub.doneAt = today
        sub.text = String(it.text || sub.name).slice(0, 40)
        addPoints(goal, sub.points || 5, 'subitem', `${step.step.slice(0, 12)}·${sub.name}：${sub.text.slice(0, 16)}`)
        applied.push({ subIndex: Number(it.subIndex), text: sub.text, name: sub.name })
      }
    }
    if (!applied.length) {
      const allNeg = isNegatedText(t)
      return allNeg
        ? { error: '这些内容看起来都还没发生（还没吃/还没到/没记），先不落档；等发生了再随手记～' }
        : { error: '这些内容今天都已经记过了' }
    }

    // 逐项留痕（轨迹可见"早餐：鸡蛋+牛奶"）
    for (const a of applied) {
      pushProgress(goal, { date: today, source: 'manual', type: 'subitem', stepIndex, note: `${a.name}：${a.text || ''}`.slice(0, 30) })
    }
    goal.lastCheckin = today

    // 今天全部细分项完成 → 记完整一天（计入达标/连续），发连续加成，查自动完成
    if (subs.every((s) => s.doneAt === today)) {
      const fullText = subs.map((s) => `${s.name}:${s.text || ''}`).join('；')
      step.logs = step.logs || []
      step.logs.push({ date: today, text: fullText, points: 0 })
      pushProgress(goal, { date: today, source: 'manual', type: step.type === 'journal' ? 'journal' : 'checkin', stepIndex, note: '今日全部细分项完成 ✓' })
      applyStreak(goal, step)
      const days = new Set(step.logs.map((l) => l.date)).size
      if (days >= requiredCount(step.metric)) finishStep(profile, goal, step, stepIndex, '细分项全部完成自动达标')
    }
    return { ok: true, goal, step, applied, fullToday: subs.every((s) => s.doneAt === today) }
  }

  /* ---------- 无细分项：原单条记录逻辑 ---------- */
  if (step.type === 'journal' && !t) return { error: '这一步需要记录点内容（可点快捷选项或自己写）' }
  step.logs = step.logs || []
  if (step.logs.some((l) => l.date === today)) return { error: '今天已经记过了，可用 ✏️ 补充修改' }

  const base = step.type === 'journal' ? 10 : 5
  step.logs.push({ date: today, text: t || (step.type === 'journal' ? '完成记录' : '打卡'), points: base })
  addPoints(goal, base, step.type === 'journal' ? 'journal' : 'checkin', `${step.step.slice(0, 16)}${t ? '：' + t.slice(0, 20) : ''}`)
  applyStreak(goal, step)
  pushProgress(goal, { date: today, source: 'manual', type: step.type === 'journal' ? 'journal' : 'checkin', stepIndex, note: t || '打卡' })
  goal.lastCheckin = today

  const days = new Set((step.logs || []).map((l) => l.date)).size
  if (days >= requiredCount(step.metric)) finishStep(profile, goal, step, stepIndex, '打卡达标自动完成')
  return { ok: true, goal, step, streak: stepStreak(step) }
}

/** 连续打卡加成（每档只发一次）：3 天 +5 / 7 天 +10 / 14 天 +20 */
function applyStreak(goal, step) {
  const streak = stepStreak(step)
  const awardMap = { 3: 5, 7: 10, 14: 20 }
  step.streakAwarded = step.streakAwarded || []
  for (const [n, pts] of Object.entries(awardMap)) {
    if (streak >= Number(n) && !step.streakAwarded.includes(Number(n))) {
      step.streakAwarded.push(Number(n))
      addPoints(goal, pts, 'streak', `连续 ${n} 天打卡加成`)
    }
  }
}

/** 步骤达标完成（+30），全步骤完成则目标达成（+100） */
function finishStep(profile, goal, step, stepIndex, note) {
  const today = nowDay()
  step.status = 'done'
  step.doneAt = today
  addPoints(goal, 30, 'step_done', `完成步骤：${step.step.slice(0, 16)}`)
  pushProgress(goal, { date: today, source: 'manual', type: 'step_done', stepIndex, note })
  if (goal.steps.every((s) => s.status === 'done')) {
    goal.status = 'done'
    addPoints(goal, 100, 'goal_done', `目标「${goal.title}」达成`)
    pushProgress(goal, { date: today, source: 'manual', type: 'goal_done', stepIndex: null, note: '全部步骤完成 🎉' })
  }
}

/** 随手记规则兜底：按细分项名称/时段词归位（否定感知），无法对应时归到第一个未完成项 */
function ruleSplitSubItems(step, text) {
  const subs = step.subItems || []
  const today = nowDay()
  const undone = subs.map((s, i) => ({ s, i })).filter((x) => x.s.doneAt !== today)
  if (!undone.length) return []
  const ALIAS = { 早餐: [/早餐/, /早饭/, /早上/, /早：/], 午餐: [/午餐/, /午饭/, /中午/, /中饭/], 晚餐: [/晚餐/, /晚饭/, /晚上/, /夜宵/], 加餐: [/加餐/, /下午茶/, /零食/] }
  const items = []
  const seen = new Set()
  for (const x of undone) {
    const pats = ALIAS[x.s.name] || [new RegExp(x.s.name)]
    const hit = pats.find((p) => p.test(text))
    if (!hit || seen.has(x.i)) continue
    const m = text.match(hit)
    if (!m || isNegated(text, hit)) continue
    items.push({ subIndex: x.i, text: clauseAt(text, m.index) })
    seen.add(x.i)
  }
  if (!items.length && !isNegatedText(text)) {
    // 整段无法归类（且并非全是未发生）→ 归给第一个未完成项，保留原话
    items.push({ subIndex: undone[0].i, text: clauseAt(text, 0) || text.slice(0, 40) })
  }
  return items
}

/** 截取命中关键词所在子句（按标点切分，避免把整段文本都算作单项内容） */
function clauseAt(text, idx) {
  let s = idx
  let e = idx
  while (s > 0 && !/[，,。！？;；\n]/.test(text[s - 1])) s--
  while (e < text.length && !/[，,。！？;；\n]/.test(text[e])) e++
  return text.slice(s, e).trim()
}

/** 关键词是否被否定（只在命中词所在的子句内判断，避免跨子句误伤："中午吃了X，晚饭还没吃"→只否定晚饭） */
function isNegated(text, kwRe) {
  const m = text.match(kwRe)
  if (!m) return false
  const clause = clauseAt(text, m.index)
  return NEG_RE.test(clause) && !DOUBLE_NEG_RE.test(clause)
}

const NEG_RE = /(还没|没|未|没有|不)[^。！？,，;；]{0,5}(吃|到|记|做|写|喝|量|发生|进行|打卡)/
const DOUBLE_NEG_RE = /不是没|没少吃|不是不/

/** 整段文本是否带否定（无关键词锚点时用） */
function isNegatedText(text) {
  const s = String(text || '')
  return NEG_RE.test(s) && !DOUBLE_NEG_RE.test(s)
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
  const hash = fakeNow().getDate() + goal.title.length
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
  normalizeGoals(profile)
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
