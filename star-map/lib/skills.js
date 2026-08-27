// Skill 注册表 + 调度器 v1（P0-2a，对标腾讯 ima「AI产培生」JD 职责②：Skill 调度与连接策略）
//
// 设计（三标准全文见 docs/10_迭代日志 2026-08-28 条目）：
// 1. 统一接口：每个 Skill = { id, name, category, priority, desc, rule(确定性触发), frontendOnly }
// 2. 调度策略：确定性路由优先（routeSkill 正则，稳定可解释）→ LLM 意图兜底（规则未命中时由模型判断，见 starMessages 提示词）
// 3. 全程留痕：每次调度写 profile.skillLog（来源 rule|llm、结果 started|completed），后台可统计触发率/完成率
// 下线标准：连续 2 周触发率 <1% 且无 completed → 进入观察名单，观察 1 周仍无回升则下线（从 SKILLS 移除 + 日志记录）

export const SKILLS = [
  {
    id: 'quiz',
    name: '对话式测验',
    category: '陪伴',
    priority: 30,
    desc: '花/动物/职业三套题库主持，结果个性化并自动存入测试报告',
    rule: /测一测|我是什么花|什么花|什么动物|小动物|职业方向|我适合什么/,
  },
  {
    id: 'energy',
    name: '今日能量提示',
    category: '陪伴',
    priority: 25,
    desc: '基于画像的倾向性提示，只说"可能/也许"，不说吉凶',
    rule: /今日能量|我最近状态|运势|精力怎么样/,
  },
  {
    id: 'goalBreak',
    name: '目标拆解',
    category: '指路',
    priority: 20,
    desc: '把目标拆成 3~5 步可执行步骤 + 每步量化指标（只动自己、四问过滤）',
    rule: /定个目标|立个目标|目标拆|帮我拆|拆解.*目标|怎么开始|行动计划|我想改变|想改掉|我想养成/,
  },
  {
    id: 'quickStart',
    name: '快速开始话题',
    category: '内容',
    priority: 0,
    desc: '3 条画像感知的开场话题提示（前端主动调用，不走自然语言路由）',
    rule: null,
    frontendOnly: true,
  },
]

export function getSkill(id) {
  return SKILLS.find((s) => s.id === id) || null
}

/**
 * 确定性路由：按 priority 从高到低匹配用户输入。
 * 返回 { skill, source:'rule' }；未命中返回 null（交给 LLM 兜底分类）。
 */
export function routeSkill(text) {
  const t = String(text || '')
  if (!t) return null
  const hit = [...SKILLS]
    .filter((s) => s.rule && !s.frontendOnly)
    .sort((a, b) => b.priority - a.priority)
    .find((s) => s.rule.test(t))
  return hit ? { skill: hit, source: 'rule' } : null
}

/** 供 starMessages 提示词使用的技能目录（只列自然语言可触发的技能） */
export function skillCatalogForPrompt() {
  return SKILLS.filter((s) => !s.frontendOnly)
    .map((s) => `${s.id}（${s.name}）：${s.desc}`)
    .join('\n')
}

/**
 * 调度留痕：写 profile.skillLog（上限 200 条，超出丢弃最旧）。
 * outcome: started(已开启) | completed(已产出结果) | aborted(中途放弃)
 */
export function recordSkillLog(profile, { skillId, source, outcome, detail = '' }) {
  const skill = getSkill(skillId)
  profile.skillLog = profile.skillLog || []
  profile.skillLog.push({
    date: new Date().toISOString().slice(0, 10),
    skillId,
    skillName: skill ? skill.name : skillId,
    category: skill ? skill.category : '',
    source: source || 'rule',
    outcome,
    detail: String(detail || '').slice(0, 80),
  })
  if (profile.skillLog.length > 200) profile.skillLog = profile.skillLog.slice(-200)
}

/** 单用户 Skill 统计：总触发 / 开启 / 完成 / 最近触发（供后台聚合与画像诊断） */
export function skillStats(profile) {
  const log = profile.skillLog || []
  const by = {}
  for (const e of log) {
    const s = by[e.skillId] || { skillId: e.skillId, name: e.skillName, total: 0, started: 0, completed: 0, lastAt: '' }
    s.total += 1
    if (e.outcome === 'started') s.started += 1
    if (e.outcome === 'completed') s.completed += 1
    s.lastAt = e.date
    by[e.skillId] = s
  }
  return Object.values(by).sort((a, b) => b.total - a.total)
}
