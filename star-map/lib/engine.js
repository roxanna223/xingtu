// 画像引擎闭环：抽取 → 归并 → 报告 → 反馈回写
// 双模：有 DEEPSEEK_API_KEY 走 LLM，无 Key 自动降级规则 Mock（保证演示不依赖网络）

import { extractMessages, reportMessages, periodReportMessages, goalBreakMessages } from './prompts.js'
import { personaSignal } from './cohort.js'
import { emotionCountsFromTrack, mixEmotionColors, mockMoodNote } from './colors.js'
import { moodFromCounts } from './mood.js'
import { aiMoodCard } from './moodImage.js'
import { QUIZZES, pickResult } from './quizzes.js'
import { behaviorSummary } from './behavior.js'
import { routeSkill } from './skills.js'

function llmConfig() {
  return {
    key: process.env.DEEPSEEK_API_KEY || '',
    base: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    mock: !process.env.DEEPSEEK_API_KEY,
  }
}

export async function callLLM(messages) {
  const cfg = llmConfig()
  if (cfg.mock) throw new Error('NO_KEY')
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

export function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {}
  const m = String(text).match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {}
  }
  return null
}

const today = () => new Date().toISOString().slice(0, 10)

/* ---------------- 主流程：抽取 + 归并 ---------------- */

export async function extractAndMerge(record, profile) {
  const cfg = llmConfig()
  let result
  if (cfg.mock) {
    result = mockExtract(record)
    result._mockFallback = true
  } else {
    try {
      const raw = await callLLM(extractMessages(record, profile.topics))
      const parsed = parseJson(raw)
      if (!parsed || !Array.isArray(parsed.topics)) {
        result = mockExtract(record)
        result._mockFallback = true
      } else result = { topics: parsed.topics || [], crisis: !!parsed.crisis }
    } catch (e) {
      console.warn('[engine] LLM 抽取失败，降级 Mock：', e.message)
      result = mockExtract(record)
      result._mockFallback = true
    }
  }
  mergeIntoProfile(profile, result.topics, record)
  if (result.crisis) profile.crisisFlag = true
  return result
}

function mergeIntoProfile(profile, topics, record) {
  if (!Array.isArray(topics) || !topics.length) return
  const resolved = []

  for (const tp of topics) {
    let node = null
    if (tp.mergeToId) node = profile.topics.find((t) => t.id === tp.mergeToId)
    if (!node && tp.name) node = profile.topics.find((t) => t.name === tp.name)
    if (!node && tp.name) {
      node = {
        id: 't' + Math.random().toString(36).slice(2, 8),
        name: String(tp.name).slice(0, 20),
        domain: tp.domain || '自我',
        emotion: '平静',
        polarity: 0,
        _polSum: 0,
        _polCount: 0,
        firstSeen: record.date,
        lastActive: record.date,
        freq: 0,
        quotes: [],
      }
      profile.topics.push(node)
    }
    if (!node) continue
    resolved.push({ tp, node })
  }

  // 更新节点
  for (const { tp, node } of resolved) {
    node.freq = (node.freq || 0) + 1
    node.lastActive = record.date
    if (tp.emotion) node.emotion = tp.emotion
    if (typeof tp.polarity === 'number') {
      node._polSum = (node._polSum || 0) + tp.polarity
      node._polCount = (node._polCount || 0) + 1
      node.polarity = Math.round((node._polSum / node._polCount) * 100) / 100
    }
    if (tp.quote && !(node.quotes || []).includes(tp.quote)) {
      node.quotes = [...(node.quotes || []), String(tp.quote).slice(0, 40)].slice(-5)
    }
  }

  // 更新关联边（先建全节点再按名字精确匹配；无向边每对每次共现只计一次 +0.3，上限 1.0）
  const idByName = new Map(profile.topics.map((t) => [t.name, t.id]))
  for (const { tp, node } of resolved) {
    for (const rel of tp.relatedTopics || []) {
      const targetId = idByName.get(rel)
      if (!targetId || targetId === node.id) continue
      if (node.id > targetId) continue
      const edge = profile.edges.find(
        (e) =>
          (e.source === node.id && e.target === targetId) ||
          (e.source === targetId && e.target === node.id)
      )
      if (edge) edge.weight = Math.min(1, (edge.weight || 0) + 0.3)
      else profile.edges.push({ source: node.id, target: targetId, weight: 0.3 })
    }
  }

  // 情绪时间序列（当日最强情绪）
  const strongest = resolved.reduce(
    (a, r) => ((r.tp.intensity || 0) > (a.intensity || 0) ? r.tp : a),
    resolved[0]?.tp || null
  )
  if (strongest) {
    const idx = profile.emotionSeries.findIndex((e) => e.date === record.date)
    const entry = { date: record.date, topEmotion: strongest.emotion || '平静', intensity: strongest.intensity || 3 }
    if (idx >= 0) profile.emotionSeries[idx] = entry
    else {
      profile.emotionSeries.push(entry)
      profile.emotionSeries.sort((a, b) => a.date.localeCompare(b.date))
    }
  }

  // 暗层 persona 判定（弱信号不覆盖）
  const sig = personaSignal(`${record.freeText}\n${record.q1}\n${record.q2}\n${record.q3}`)
  if (sig) profile.user.personaTier = sig
}

/* ---------------- 报告生成 ---------------- */

export async function generateReport(profile, tier, todayTrack = '', todayRecord = null, intent = 'none', patterns = []) {
  const cfg = llmConfig()
  let report
  let base = null
  if (cfg.mock) {
    report = mockReport(profile, todayTrack, todayRecord, intent, patterns)
  } else {
    try {
      const raw = await callLLM(reportMessages(profile, tier, todayTrack, todayRecord, intent, patterns))
      const parsed = parseJson(raw)
      base = mockReport(profile, todayTrack, todayRecord, intent, patterns)
      report = parsed && (parsed.playback || parsed.observations) ? { ...base, ...parsed } : base
    } catch (e) {
      console.warn('[engine] LLM 报告失败，降级 Mock：', e.message)
      report = mockReport(profile, todayTrack, todayRecord, intent, patterns)
    }
  }
  // 采纳回顾兜底（LLM 与 Mock 都只引用真实数据；LLM 空输出时用确定性版本补齐）
  if (!report.adoptionReview) report.adoptionReview = (base || report).adoptionReview || adoptionReviewFallback(profile)
  // suggestionTopic 兜底：LLM 未给出时取主导域最高频主题；无建议则置空
  if (report.suggestion && !report.suggestionTopic) {
    const t = dominantTopic(profile)
    report.suggestionTopic = t ? t.name : ''
  }
  if (!report.suggestion) report.suggestionTopic = ''
  report.generatedAt = today()
  report.crisis = report.crisis || !!profile.crisisFlag

  // 心情卡：规则表兜底，有 MOONSHOT_API_KEY 时用 Kimi 按需增强（每天最多一次，随报告缓存）
  const counts = emotionCountsFromTrack(todayTrack)
  report.moodCard = moodFromCounts(counts)
  try {
    const ai = await aiMoodCard({
      counts,
      topTopics: report.topTopics || [],
      freeText: todayRecord?.freeText || '',
    })
    if (ai) report.moodCard = ai
  } catch {
    /* 保留规则版 */
  }

  profile.lastReport = report
  return report
}

function mockReport(profile, todayTrack = '', todayRecord = null, intent = 'none', patterns = []) {
  const topics = profile.topics || []
  const domainCount = {}
  for (const t of topics) domainCount[t.domain] = (domainCount[t.domain] || 0) + (t.freq || 1)
  const dominant = Object.entries(domainCount).sort((a, b) => b[1] - a[1])[0]
  const topTopics = [...topics].sort((a, b) => (b.freq || 0) - (a.freq || 0)).slice(0, 3).map((t) => t.name)
  const dom = dominant ? dominant[0] : ''
  const counts = emotionCountsFromTrack(todayTrack)

  const free = String(todayRecord?.freeText || '').slice(0, 90)
  const observations = topTopics.slice(0, 2).map((name) => {
    const t = topics.find((x) => x.name === name)
    return { text: `你多次提到「${name}」，它最近出现在 ${t?.lastActive || '记录里'}`, quote: t?.quotes?.[0] || '' }
  })

  // 尺度判断：纯倾诉/一次性事件不给建议；求助或长期模式才给
  let suggestion = ''
  if (intent === 'advice' || (patterns && patterns.length && topTopics.some((x) => patterns.includes(x)))) {
    suggestion = dom ? pathFor(dom).action : ''
  }
  if (intent === 'vent' && !suggestion) {
    observations.push({ text: '今天主要是想说出来，对吧？', quote: '' })
  }

  return {
    playback: free ? `今天你提到：${free}${free.length >= 90 ? '…' : ''}` : '今天还没有记录。',
    observations,
    suggestion,
    suggestionTopic: suggestion ? (topics.find((t) => t.domain === dom) || topics[0])?.name || '' : '',
    adoptionReview: adoptionReviewFallback(profile),
    nextQuestion: topTopics[0]
      ? `明天我们可以只聊一个问题：${topTopics[0]} 最近让你最困扰的具体场景是什么？`
      : '明天我们聊聊：最近一周里最让你有能量的一个时刻是什么？',
    moodColor: mixEmotionColors(counts),
    moodNote: mockMoodNote(counts),
    dominantDomain: dom,
    topTopics,
  }
}

function pathFor(domain) {
  const P = {
    事业: {
      action: '本周安排 2 次 30 分钟的信息行动：投递 3 份岗位 / 约 1 次行业前辈沟通 / 写一版方向清单',
      expected: '方向感增强，决策焦虑下降',
      signal: '完成第 2 次行动后，记录中"事业"相关负向表达减少',
    },
    关系: {
      action: '本周主动发起 1 次高质量沟通：把一件积压的误会或诉求当面/电话说清楚',
      expected: '关系压力释放，独处时反刍减少',
      signal: '提到该关系的记录中情绪极性回升',
    },
    自我: {
      action: '本周做 1 次 20 分钟的"想法清空书写"，把自我怀疑逐条写下并标注证据支持度',
      expected: '内耗下降，对自身状态有更清晰判定',
      signal: '记录中"内耗/迷茫"类表达频率下降',
    },
    健康: {
      action: '本周固定 3 次运动（每次 30 分钟，散步即可）+ 连续 3 天 12 点前入睡',
      expected: '精力回升，压力躯体化症状减轻',
      signal: '记录中"疲惫"出现次数下降',
    },
    财务: {
      action: '本周用 30 分钟做一次现金流盘点：列出固定支出与 3 个月缓冲线',
      expected: '财务不确定感下降，可支配感上升',
      signal: '记录中"钱"相关焦虑表达减少',
    },
    成长: {
      action: '本周选 1 个技能/兴趣，投入 2 个完整 45 分钟专注块，并记录一次成果',
      expected: '获得感上升，自我效能感增强',
      signal: '记录中"充实/期待"类表达增加',
    },
  }
  return P[domain] || P['自我']
}

/* ---------------- 建议采纳闭环（P0 · 指路验证 Q6） ---------------- */

/**
 * 用户对某份报告的建议标记「已做/未做」。
 * 落三处：① adoptions 存证（含标记时刻主题极性快照，供后续报告回顾变化）
 *        ② 主题执行标记 actionState（报告可直接读取"这条建议的执行状态"）
 *        ③ adaptLog 审计（自迭代 SCALE 闭环的 Log 环节）
 * 同一份报告重复标记 = 更新，不重复累积。
 */
export function applyAdoption(profile, { reportKey, suggestion, adopted, date, reportDay, suggestionTopicName }) {
  const topics = profile.topics || []
  // 解析建议指向的主题：优先报告生成的 suggestionTopic，兜底主导域最高频主题
  let topic = suggestionTopicName ? topics.find((t) => t.name === suggestionTopicName) : null
  if (!topic) topic = dominantTopic(profile)
  profile.adoptions = profile.adoptions || []
  const rec = {
    id: 'ad' + Math.random().toString(36).slice(2, 8),
    date,
    reportDay: reportDay || null, // 报告所属日期（周期归属用它，不用标记日期）
    reportKey,
    suggestion: String(suggestion || '').slice(0, 120),
    adopted: !!adopted,
    topicId: topic ? topic.id : null,
    topicName: topic ? topic.name : null,
    polarityAtAdoption: topic ? topic.polarity : null,
  }
  const idx = profile.adoptions.findIndex((a) => a.reportKey === reportKey)
  if (idx >= 0) profile.adoptions[idx] = { ...profile.adoptions[idx], ...rec, id: profile.adoptions[idx].id }
  else profile.adoptions.push(rec)
  if (topic) topic.actionState = { adopted: !!adopted, date, reportKey }
  profile.adaptLog = profile.adaptLog || []
  profile.adaptLog.push({ date, type: 'adoption', reportKey, adopted: !!adopted, topicId: topic ? topic.id : null })
  return rec
}

/** 主导域最高频主题（无主题时为 null） */
function dominantTopic(profile) {
  const topics = profile.topics || []
  if (!topics.length) return null
  const domCount = {}
  for (const t of topics) domCount[t.domain] = (domCount[t.domain] || 0) + (t.freq || 1)
  const dom = Object.entries(domCount).sort((a, b) => b[1] - a[1])[0]?.[0]
  const inDom = topics.filter((t) => t.domain === dom).sort((a, b) => (b.freq || 0) - (a.freq || 0))
  return inDom[0] || [...topics].sort((a, b) => (b.freq || 0) - (a.freq || 0))[0]
}

/**
 * 采纳上下文（注入报告提示词用）：每条带「标记时刻极性 vs 当前极性」。
 * range 传 {start,end} 时只取区间内标记；否则取最近 5 条。
 */
export function adoptionContext(profile, range = null) {
  const all = profile.adoptions || []
  const list = range
    ? all.filter((a) => (a.reportDay || a.date) >= range.start && (a.reportDay || a.date) <= range.end)
    : all.slice(-5)
  return list.map((a) => {
    const t = (profile.topics || []).find((x) => x.id === a.topicId || x.name === a.topicName)
    return {
      date: a.date,
      suggestion: a.suggestion,
      adopted: a.adopted,
      topicName: a.topicName || null,
      polarityAtAdoption: a.polarityAtAdoption,
      currentPolarity: t ? t.polarity : null,
    }
  })
}

/**
 * 采纳回顾确定性兜底：只引用真实数据，无数据/无变化时返回空串。
 * LLM 未产出 adoptionReview 时用此填充（Mock 模式也走这里）。
 */
function adoptionReviewFallback(profile) {
  const adoptions = profile.adoptions || []
  if (!adoptions.length) return ''
  const a = adoptions[adoptions.length - 1]
  const t = (profile.topics || []).find((x) => x.id === a.topicId || x.name === a.topicName)
  if (!t || a.polarityAtAdoption == null) return ''
  const sug = String(a.suggestion || '').slice(0, 40)
  if (a.adopted) {
    return `上次建议「${sug}…」，你标记做到了。现在「${t.name}」的极性是 ${t.polarity}（标记时是 ${a.polarityAtAdoption}）。`
  }
  return `上次建议「${sug}…」，你标记还没做。没关系，我们可以在下次记录里一起看看怎么调整。`
}

/* ---------------- 反馈回写 ---------------- */

export function applyFeedback(profile, { helpful, comment }) {
  profile.feedbackLog.push({ date: today(), helpful: !!helpful, comment: comment || '' })
  const adjusted = []
  const c = String(comment || '')
  for (const t of profile.topics || []) {
    if (c && (c.includes(t.name) || (t.quotes || []).some((q) => c.includes(q.slice(0, 6))))) {
      const shift = helpful ? 0.2 : -0.15
      t.polarity = Math.max(-1, Math.min(1, Math.round(((t.polarity || 0) + shift) * 100) / 100))
      // 反馈提及 = 再次关注该主题：频次 +1（星图粒子大小随频次增长，兑现"你的反馈会直接改变明天的星图"）
      t.freq = Math.max(1, (t.freq || 1) + 1)
      t.lastActive = today()
      // 同时强化该主题的关联连线（与抽取归并时的边强化一致）
      for (const e of profile.edges || []) {
        if (e.source === t.id || e.target === t.id) {
          e.weight = Math.min(1, (e.weight || 0) + 0.3)
        }
      }
      adjusted.push(t.name)
    }
  }
  return adjusted
}

/* ---------------- Mock 对话（无 Key 兜底，规则版） ---------------- */

const MOCK_HOLD = [
  '嗯，我在听，你慢慢说。',
  '听起来那一下挺难受的。然后呢？',
  '我记下了，还有别的想说的吗？',
]

export function mockChat(history = [], draft = null, forcedOpener = null) {
  const userTurns = (history || []).filter((m) => m.role === 'user')
  const lastUser = userTurns.at(-1)?.content || ''
  const wantDraft = lastUser.includes('[帮我梳理今天]') || /帮我梳理|帮我总结|整理一下|就这些|大概这样|没了$|好了$/.test(lastUser)

  if (draft) {
    if (wantDraft) {
      return { reply: '好，我按你说的调整了。你再看一眼，还有想改的地方吗？', draft, done: true }
    }
    return { reply: MOCK_HOLD[userTurns.length % MOCK_HOLD.length], draft, done: false }
  }

  if (userTurns.length === 0) {
    return {
      reply: forcedOpener ? `${forcedOpener.q}` : '今天情绪起伏最大的那一刻，发生在什么场景里？',
      draft: null,
      done: false,
    }
  }

  if (wantDraft) {
    const em = topEmotion((history || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n'))
    return {
      reply: '好的，我知道了。我把今天的梳理放在下面，你可以直接改，改好点确认就能保存今天的星图。',
      draft: {
        q1: userTurns[0].content.slice(0, 30),
        q2: [{ event: userTurns[0].content.slice(0, 24), emotions: [em] }],
        q3: '',
        summary: userTurns.map((u) => u.content).join('；').slice(0, 60),
      },
      done: true,
    }
  }

  return { reply: MOCK_HOLD[userTurns.length % MOCK_HOLD.length], draft: null, done: false }
}

/* ---------------- 小星（陪伴 IP） ---------------- */

export function buildProfileSummary(profile) {
  const topics = profile.topics || []
  const domainCount = {}
  for (const t of topics) domainCount[t.domain] = (domainCount[t.domain] || 0) + (t.freq || 1)
  const dominant = Object.entries(domainCount).sort((a, b) => b[1] - a[1])[0]
  return {
    username: profile.user?.username || '',
    starSign: profile.user?.starSign || null,
    lifeTask: profile.user?.cohort?.lifeTask || '',
    careerStage: profile.user?.careerStage || '',
    dayCount: (profile.emotionSeries || []).length,
    recentEmotion: (profile.emotionSeries || []).at(-1)?.topEmotion || '',
    dominantDomain: dominant ? dominant[0] : '',
    topTopics: [...topics].sort((a, b) => (b.freq || 0) - (a.freq || 0)).slice(0, 5).map((t) => t.name),
    testCount: (profile.tests || []).length,
    lastJudgement: profile.lastReport?.judgement || '',
    behavior: behaviorSummary(profile),
  }
}

export function mockSuggestions(summary = {}) {
  const topic = summary.topTopics?.[0]
  return {
    suggestions: [
      topic ? `聊聊「${topic}」最近怎么样了` : '最近有什么让我纠结的事',
      '测一测我是什么花',
      summary.lifeTask ? '我最近该把精力放在哪里' : '测一测我的职业方向',
    ],
  }
}

export function mockStar(history = [], quiz = null, summary = {}) {
  const userTurns = (history || []).filter((m) => m.role === 'user')
  const lastUser = userTurns.at(-1)?.content || ''
  const joined = userTurns.map((u) => u.content).join('\n')

  // Skill 调度（P0-2a）：确定性路由优先——goalBreak 命中即执行，不进入闲聊/测验流程
  if (!quiz) {
    const hit = routeSkill(lastUser)
    if (hit?.skill?.id === 'goalBreak') return mockGoalBreak(lastUser, summary)
  }

  // 测验意图识别
  const intent =
    /花|花朵/.test(lastUser) ? 'flower'
    : /动物|小动物/.test(lastUser) ? 'animal'
    : /职业|工作方向/.test(lastUser) ? 'career'
    : /能量|运势|状态|精力/.test(lastUser) ? 'energy'
    : null

  if (!quiz && intent) {
    if (intent === 'energy') {
      const em = summary.recentEmotion || '平静'
      return {
        reply: '好，我看了看你最近的状态——',
        quiz: null,
        result: {
          quizId: 'energy',
          title: '今日能量提示',
          emoji: '✨',
          headline: `最近你的主色调是${em}`,
          content: `你最近的情绪以「${em}」为主${summary.dominantDomain ? `，主要耗能在${summary.dominantDomain}域` : ''}。今天也许适合给自己留 20 分钟安静的时间，把最重的那件事拆成一小步先做起来。倾向性提示，不是断言，你按自己的节奏来。`,
        },
      }
    }
    const qz = QUIZZES[intent]
    return {
      reply: `好呀，来测测看。第 1/${qz.questions.length} 题：`,
      quiz: { id: intent, title: qz.title, emoji: qz.emoji, index: 1, total: qz.questions.length, question: qz.questions[0].q, options: qz.questions[0].options },
      result: null,
    }
  }

  if (quiz) {
    const qz = QUIZZES[quiz.id]
    const next = quiz.index + 1
    if (qz && quiz.index < qz.questions.length) {
      return {
        reply: `记下了。第 ${next}/${qz.questions.length} 题：`,
        quiz: { ...quiz, index: next, question: qz.questions[next - 1].q, options: qz.questions[next - 1].options },
        result: null,
      }
    }
    const r = pickResult(quiz.id, userTurns.map((u) => u.content))
    return { reply: '测完啦，这是你的结果：', quiz: null, result: { quizId: quiz.id, ...r } }
  }

  // 普通闲聊（Mock 兜底）
  const topic = summary.topTopics?.[0]
  return {
    reply: topic
      ? `我在听。你最近常提到「${topic}」，今天想聊它，还是说点别的？`
      : '我在听，慢慢说。',
    quiz: null,
    result: null,
  }
}

/* ---------------- Skill：目标拆解（goalBreak，P0-2a 新增） ---------------- */

// 从诉求里提取目标主体（Mock 用，粗略但可解释）
function goalTarget(text) {
  return String(text || '')
    .replace(/^(我)?(想|要|打算|准备)/, '')
    .replace(/定个目标|立个目标|目标|拆解|帮我|怎么开始|行动计划|改变|改掉|养成|[:：,，。\s]+/g, '')
    .slice(0, 24) || '这个目标'
}

/** 目标拆解 Mock（无 Key 兜底）：三步通用框架，不编造具体领域建议 */
export function mockGoalBreak(text = '', summary = {}) {
  const target = goalTarget(text)
  return {
    reply: `好，我们先把「${target}」拆成三步，每步带一个小指标，你按自己的节奏来。`,
    quiz: null,
    result: null,
    skill: {
      id: 'goalBreak',
      title: '目标拆解',
      summary: `把「${target}」变成可以走的三步`,
      steps: [
        { step: `把「${target}」写成一句话，并写下现在的状态与想要的差距`, metric: '写 1 条目标陈述 + 1 条现状记录' },
        { step: '今天完成一个 10 分钟的最小行动（只要动起来就算数）', metric: '完成 1 次并当天记录' },
        { step: '一周后回看：对比行动前后你在星图里的记录', metric: '每周复盘 1 次，连续 2 周' },
      ],
    },
  }
}

/** 目标拆解（LLM + Mock 兜底），调用方通过 routeSkill 确定性路由进入 */
export async function generateGoalBreak(text, summary = {}) {
  const cfg = llmConfig()
  if (cfg.mock) return mockGoalBreak(text, summary)
  try {
    const raw = await callLLM(goalBreakMessages(text, summary))
    const parsed = parseJson(raw)
    if (parsed?.skill?.id === 'goalBreak' && Array.isArray(parsed.skill.steps) && parsed.skill.steps.length) {
      return { reply: parsed.reply || '我们把目标拆成几步：', quiz: null, result: null, skill: parsed.skill }
    }
  } catch (e) {
    console.warn('[engine] 目标拆解失败，降级 Mock：', e.message)
  }
  return mockGoalBreak(text, summary)
}

/* ---------------- 周期报告（周/月/季/年） ---------------- */

// 周期报告缓存版本：规则升级后 bump，旧缓存自动失效重新生成
export const PERIOD_CACHE_VERSION = 2

// 空数据守卫：周期内 0 天记录时不调 LLM，直接输出最小报告。
// 修复：旧版在空数据时仍走 LLM，产生诗意填充、把 cohort 当判定依据、"您/你"混用。
export function minimalPeriodReport(agg) {
  return {
    playback: `${agg?.periodLabel || '这个周期'}还没有记录。`,
    trends: [],
    observations: [],
    suggestion: '',
    suggestionTopic: '',
    adoptionReview: '',
    nextQuestion: '从今天开始，哪怕只写一句话，这个周期也会留下你的痕迹。',
    moodColor: '#8f9db8', // 雾灰（中性，不暗示）
    moodNote: '这个周期还没有留下心情颜色。',
    cacheVersion: PERIOD_CACHE_VERSION,
  }
}

export async function generatePeriodReport(profile, agg) {
  if (!agg || !agg.dayCount || !agg.seriesCount) {
    return minimalPeriodReport(agg)
  }
  const cfg = llmConfig()
  let report
  const base = mockPeriodReport(agg)
  if (cfg.mock) {
    report = base
  } else {
    try {
      const raw = await callLLM(periodReportMessages(profile, agg))
      const parsed = parseJson(raw)
      report = parsed && (parsed.playback || parsed.trends) ? { ...base, ...parsed } : base
    } catch (e) {
      console.warn('[engine] 周期报告失败，降级 Mock：', e.message)
      report = base
    }
  }
  // 采纳回顾兜底：LLM 空输出时用确定性版本补齐（同样只引用真实数据）
  if (!report.adoptionReview) report.adoptionReview = base.adoptionReview
  if (report.suggestion && !report.suggestionTopic) report.suggestionTopic = (agg.topTopics || [])[0]?.name || ''
  if (!report.suggestion) report.suggestionTopic = ''
  report.generatedAt = today()
  report.cacheVersion = PERIOD_CACHE_VERSION
  return report
}

function mockPeriodReport(agg) {
  const dist = Object.entries(agg.emotionDist || {}).sort((a, b) => b[1] - a[1])
  const topEm = dist[0]
  const prefix = agg.dataNote ? `${agg.dataNote} ` : ''
  const trends = [
    agg.seriesCount
      ? `${agg.periodLabel || '本周期'}（${agg.start} ~ ${agg.end}）记录了 ${agg.dayCount}/${agg.totalDays} 天${topEm ? `，「${topEm[0]}」出现最多（${topEm[1]} 天）` : ''}`
      : `${agg.periodLabel || '本周期'}还没有记录`,
    agg.topTopics?.length ? `「${agg.topTopics[0].name}」是周期最活跃的主题（提及 ${agg.topTopics[0].freq} 次）` : '',
    agg.topTopics?.length > 1 ? `其次是「${agg.topTopics[1].name}」` : '',
  ].filter(Boolean)
  const observations = (agg.topTopics || []).slice(0, 2).map((t) => ({
    text: `「${t.name}」贯穿了这段时间的${t.domain}域记录`,
    quote: t.quotes?.[0] || '',
  }))
  // 采纳回顾（确定性）：只引用 agg.adoptions 里的真实极性快照与当前极性
  let adoptionReview = ''
  const adopt = (agg.adoptions || []).filter((a) => a.currentPolarity != null && a.polarityAtAdoption != null)
  if (adopt.length) {
    const a = adopt[adopt.length - 1]
    const sug = String(a.suggestion || '').slice(0, 40)
    adoptionReview = a.adopted
      ? `上次建议「${sug}…」，你标记做到了。现在「${a.topicName}」的极性是 ${a.currentPolarity}（标记时是 ${a.polarityAtAdoption}）。`
      : `上次建议「${sug}…」，你标记还没做。没关系，我们可以在下次记录里一起看看怎么调整。`
  }
  return {
    playback: agg.dayCount
      ? `${prefix}${agg.periodLabel || '这个周期'}里，你记录了 ${agg.dayCount} 天${agg.topTopics?.length ? `，最常出现的是「${agg.topTopics[0].name}」` : ''}。`
      : `${prefix}${agg.periodLabel || '这个周期'}还没有记录。`,
    trends,
    observations,
    suggestion: '',
    suggestionTopic: '',
    adoptionReview,
    nextQuestion: '下一个周期，你想让哪一件事发生变化？',
    moodColor: agg.moodColor,
    moodNote: topEm ? `这个周期的颜色主要来自「${topEm[0]}」。` : '这个周期还没有留下心情颜色。',
  }
}

/* ---------------- Mock 抽取（无 Key 兜底，规则版） ---------------- */

const DOMAIN_KW = {
  事业: ['工作', '实习', '面试', '简历', 'offer', '老板', '领导', '同事', '转行', '考研', '考公', '毕业', '秋招', '春招', '加班', '项目', '笔试', '题库'],
  关系: ['爸妈', '父母', '妈妈', '爸爸', '家人', '朋友', '对象', '男朋友', '女朋友', '室友', '亲戚', '社交', '恋爱'],
  自我: ['迷茫', '内耗', '自我', '价值', '意义', '目标', '拖延', '怀疑自己'],
  健康: ['累', '疲惫', '身体', '睡', '失眠', '运动', '生病', '头疼', '熬夜'],
  财务: ['钱', '工资', '房租', '花呗', '负债', '省钱', '涨薪', '理财', '存款'],
  成长: ['学习', '读书', '技能', '课程', '英语', '兴趣', '进步', '看书'],
}

const EMOTION_KW = {
  焦虑: ['焦虑', '烦', '慌', '担心', '怕'],
  疲惫: ['累', '疲惫', '困', '乏'],
  迷茫: ['迷茫', '不知道', '困惑', '方向'],
  愤怒: ['生气', '愤怒', '气死', '不爽'],
  平静: ['平静', '淡定', '放松'],
  期待: ['期待', '希望', '盼', '想试试'],
  低落: ['低落', '难过', '哭', 'emo', '抑郁'],
  充实: ['充实', '满足', '开心', '成就感'],
}

const POLARITY = { 焦虑: -0.6, 疲惫: -0.5, 迷茫: -0.4, 愤怒: -0.7, 平静: 0.1, 期待: 0.6, 低落: -0.7, 充实: 0.8 }
const CRISIS_RE = /自杀|不想活|自残|结束生命|活不下去/

function sentenceWith(text, kw) {
  const parts = String(text).split(/[。！？\n]/)
  const hit = parts.find((p) => p.includes(kw))
  return hit ? hit.trim().slice(0, 40) : ''
}

function emotionCount(text) {
  let total = 0
  for (const kws of Object.values(EMOTION_KW)) for (const k of kws) if (text.includes(k)) total++
  return total
}

function topEmotion(text) {
  let best = '平静'
  let bestN = 0
  for (const [em, kws] of Object.entries(EMOTION_KW)) {
    let n = 0
    for (const k of kws) if (text.includes(k)) n++
    if (n > bestN) {
      bestN = n
      best = em
    }
  }
  return best
}

export function mockExtract(record) {
  const text = `${record.freeText || ''}\n${record.q1 || ''}\n${record.q2 || ''}\n${record.q3 || ''}`
  const crisis = CRISIS_RE.test(text)
  const found = []
  for (const [domain, kws] of Object.entries(DOMAIN_KW)) {
    for (const kw of kws) {
      if (text.includes(kw)) {
        found.push({ domain, kw })
        break
      }
    }
  }
  const emotion = topEmotion(text)
  const topics = found.slice(0, 4).map((f) => ({
    name: `${f.domain}·${f.kw}`,
    domain: f.domain,
    emotion,
    polarity: POLARITY[emotion] || 0,
    intensity: Math.min(9, 3 + emotionCount(text)),
    relatedTopics: [],
    quote: sentenceWith(text, f.kw) || `${f.kw}相关记录`,
    mergeToId: null,
  }))
  // Mock 模式下把同日出现的主题两两关联，保证星图有连线
  if (topics.length > 1) {
    for (const t of topics) {
      t.relatedTopics = topics.filter((o) => o.name !== t.name).map((o) => o.name)
    }
  }
  if (!topics.length) {
    topics.push({
      name: '自我·日常记录',
      domain: '自我',
      emotion,
      polarity: POLARITY[emotion] || 0,
      intensity: 3,
      relatedTopics: [],
      quote: String(record.freeText || '').slice(0, 30),
      mergeToId: null,
    })
  }
  return { topics, crisis }
}
