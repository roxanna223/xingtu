// 小星进化层 v1（docs/23 统一方案 §3.1 / §4.1，借鉴 ECC continuous-learning-v2 + Letta + ReMe）
//
// 设计：
// - 个人资产 = persona 三文档（self/persona/working，Markdown 事实源）+ profiles.persona_meta 本能条目
// - 本能条目 = ECC instinct 契约：{id, trigger, behavior, confidence, domain, evidence, trust, lastSeen}
// - 置信度演化：确认 +0.05 / 用户纠正 −0.1 / 每周衰减 −0.02；低于 0.2 淘汰
// - 记忆≠指令：所有条目 trust=unreviewed，注入前压缩为有界摘要，红线（危机/命理/医疗）永远硬编码优先
// - Mock 模式（无 API Key）：不调用 LLM，仅保留规则层（反馈纠正、衰减仍生效）

import { readPersonaDocs, writePersonaDoc, readProfile, writeProfile, withStoreLock } from './store.js'
import { callLLM, parseJson } from './engine.js'
import { instinctExtractMessages } from './prompts.js'

const CONF_BOOST = 0.05
const CONF_PENALTY = -0.1
const WEEK_DECAY = 0.02
const CONF_FLOOR = 0.2
const CONF_CAP = 0.9
const MAX_ENTRIES = 60
const SUMMARY_MAX_CHARS = 800

const weekMs = 7 * 86400000

/** 惰性衰减：读 meta 时对过期条目降权、淘汰弱条目（不写库，返回新数组） */
export function decayMeta(meta = [], now = Date.now()) {
  const out = []
  for (const e of meta || []) {
    const last = e.lastSeen ? new Date(e.lastSeen).getTime() : now
    const weeks = Math.max(0, Math.floor((now - last) / weekMs))
    const next = Math.round((e.confidence - weeks * WEEK_DECAY) * 100) / 100
    if (next < CONF_FLOOR) continue
    out.push({ ...e, confidence: next })
  }
  return out
}

/** 合并新观察到的本能：同 id 确认 +CONF_BOOST，新条目初值 0.3；上限 MAX_ENTRIES */
export function mergeInstincts(meta = [], incoming = [], now = new Date().toISOString()) {  const list = decayMeta(meta)
  for (const inc of incoming || []) {
    if (!inc || !inc.id) continue
    const hit = list.find((e) => e.id === inc.id)
    if (hit) {
      hit.confidence = Math.min(CONF_CAP, Math.round((hit.confidence + CONF_BOOST) * 100) / 100)
      if (inc.evidence && !(hit.evidence || '').includes(inc.evidence)) hit.evidence = inc.evidence
      hit.lastSeen = now
    } else if (list.length < MAX_ENTRIES) {
      list.push({
        id: String(inc.id).slice(0, 40),
        trigger: String(inc.trigger || '').slice(0, 40),
        behavior: String(inc.behavior || '').slice(0, 60),
        confidence: Math.min(0.5, Math.max(0.2, Number(inc.confidence) || 0.3)),
        domain: String(inc.domain || '沟通风格').slice(0, 12),
        evidence: String(inc.evidence || '').slice(0, 40),
        trust: 'unreviewed',
        lastSeen: now,
      })
    }
  }
  return list.sort((a, b) => b.confidence - a.confidence)
}

/** 用户纠正（反馈"没帮助/不太对"）→ 相关条目 −0.1；确认（有帮助/采纳）→ +0.05 */
export function applyUserSignal(meta = [], { signal, keywords = [] }) {
  const list = decayMeta(meta)
  const delta = signal === 'correct' ? CONF_PENALTY : CONF_BOOST
  const grams = keywordsToGrams(keywords)
  for (const e of list) {
    const hay = `${e.trigger} ${e.behavior} ${e.evidence}`
    // 有关键词时按重叠匹配；没有关键词（如采纳标记）时命中全部条目
    if (grams.length && !grams.some((g) => hay.includes(g))) continue
    e.confidence = Math.max(0.05, Math.min(CONF_CAP, Math.round((e.confidence + delta) * 100) / 100))
  }
  return list.filter((e) => e.confidence >= CONF_FLOOR)
}

/** 中文关键词匹配：整词 + 2 字滑动 gram，保证"转行建议"能命中"转行"相关条目 */
export function keywordsToGrams(texts = []) {
  const grams = new Set()
  for (const raw of texts) {
    const s = String(raw || '').trim()
    if (!s) continue
    const tokens = s.split(/[\s，。！？、；：,.!?;:'"（）()]+/).filter(Boolean)
    for (const t of tokens) {
      if (t.length <= 6) grams.add(t)
      for (let i = 0; i + 1 < t.length; i++) grams.add(t.slice(i, i + 2))
    }
  }
  return [...grams].slice(0, 40)
}

/** 异步观察：从最近对话抽本能并写回（不阻塞主回复；Mock 模式直接跳过） */
export async function observeSession(userId, transcript, summary) {
  if (!transcript || !process.env.DEEPSEEK_API_KEY) return
  try {
    await withStoreLock(async () => {
      const p = readProfile(userId)
      const raw = await callLLM(instinctExtractMessages(transcript, p.personaMeta || [], summary))
      const parsed = parseJson(raw)
      const incoming = parsed?.instincts || []
      if (!incoming.length) return
      p.personaMeta = mergeInstincts(p.personaMeta || [], incoming)
      writeProfile(userId, p)
    })
  } catch (e) {
    console.warn('[evolution] 观察抽取失败（忽略）：', e.message)
  }
}

/** 生成三文档事实源（每 N 天由日报作业重写一次；P0 提供基于画像的确定性版本） */
export function rebuildPersonaDocs(userId, profile) {
  const t = profile.topics || []
  const top = [...t].sort((a, b) => (b.freq || 0) - (a.freq || 0)).slice(0, 5)
  const series = profile.emotionSeries || []
  const recent = series.slice(-7).map((s) => s.topEmotion)
  const goals = (profile.goals || []).filter((g) => g.status === 'active').map((g) => g.title)

  const self = [
    `# 我是谁（小星对用户的理解）`,
    '',
    `- 职业阶段：${profile.user?.careerStage || '未知'}`,
    `- 人生任务：${profile.user?.cohort?.lifeTask || '未知'}`,
    `- 星座：${profile.user?.starSign || '未填'}`,
    top.length ? `- 长期关心的主题：${top.map((x) => x.name).join('、')}` : '- 长期关心的主题：（还没积累够）',
    goals.length ? `- 进行中的目标：${goals.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const persona = [
    `# 小星与用户的关系（怎么和他相处）`,
    '',
    `- 报告偏好：${profile.user?.personaTier === 'result' ? '结果导向，直接给结论' : '逻辑导向，喜欢原理与依据'}`,
    recent.length ? `- 近 7 天情绪主调：${recent.join('、')}` : '',
    `- 语气：口语化、不评判、不催促（固定）`,
  ]
    .filter(Boolean)
    .join('\n')

  const working = [
    `# 近期工作记忆（本周）`,
    '',
    top.length ? `- 活跃主题：${top.map((x) => `${x.name}（${x.emotion}）`).join('、')}` : '- 活跃主题：（暂无）',
    goals.length ? `- 目标进展：${goals.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  writePersonaDoc(userId, 'self', self)
  writePersonaDoc(userId, 'persona', persona)
  writePersonaDoc(userId, 'working', working)
}

/** 有界注入摘要：三文档 + 高置信本能，压缩到 SUMMARY_MAX_CHARS（ECC 有界注入思想） */
export function buildPersonaSummary(userId, profile) {
  const docs = readPersonaDocs(userId)
  const meta = decayMeta(profile.personaMeta || [])
  const strong = meta.filter((e) => e.confidence >= 0.5).slice(0, 10)
  const parts = []

  if (docs.working && docs.working.trim()) parts.push(docs.working.trim())
  if (docs.self && docs.self.trim()) parts.push(docs.self.trim())
  if (docs.persona && docs.persona.trim()) parts.push(docs.persona.trim())
  if (strong.length) {
    const lines = ['已沉淀的相处要点（用户个人资产，可纠正）：']
    for (const e of strong) lines.push(`- 当${e.trigger}时：${e.behavior}（置信 ${Math.round(e.confidence * 100)}%）`)
    parts.push(lines.join('\n'))
  }

  return parts.join('\n\n').slice(0, SUMMARY_MAX_CHARS)
}

export { readPersonaDocs }
