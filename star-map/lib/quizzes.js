// 小星对话式测验题库（可扩展：往 QUIZZES 里加新类型即可）
// 题目为通用趣味心理映射题；LLM 主持测验时严格从题库取题，结果做个性化解读
//
// 题库沉淀机制（2026-08-29）：用户想测的主题不在题库时——
//   LLM 模式：模型现场创作完整测验（freshQuiz），服务端落盘 data/custom-quizzes.json；
//   Mock 模式：makeGenericQuiz 规则模板生成并落盘。
// 沉淀后下次直接在题库命中，不再现编。

import fs from 'node:fs'
import path from 'node:path'

const CUSTOM_PATH = path.join(process.cwd(), 'data', 'custom-quizzes.json')
let customCache = null

export const QUIZZES = {
  flower: {
    title: '测一测你是什么花',
    emoji: '🌸',
    questions: [
      { q: '难得的周末，你最想怎么过？', options: ['去山里或公园走走', '宅家看书追剧', '约朋友聚会聊天', '逛展或做点手工'] },
      { q: '遇到压力时，你通常？', options: ['一个人扛，慢慢消化', '找人倾诉', '先睡一觉再说', '运动或做事转移注意力'] },
      { q: '朋友眼中的你更像？', options: ['热闹的小太阳', '安静的倾听者', '点子很多的人', '靠得住的行动派'] },
    ],
    results: [
      { title: '桃花', emoji: '🌸', headline: '人群里一眼就被你点亮', content: '你自带亲和力和生命力，情绪来得快去得也快。你适合有反馈、有温度的环境，记得在热闹之后也留时间给自己充电。' },
      { title: '向日葵', emoji: '🌻', headline: '朝着光走的人', content: '你对目标很执着，低落时也习惯自己找出口。你最大的天赋是把普通日子过得有方向感，累的时候允许自己背对太阳休息一下。' },
      { title: '薰衣草', emoji: '💜', headline: '安静却有安抚人心的力量', content: '你是很多人情绪低落时会想起的人。你的课题是：先照顾好自己，再去安抚世界，你的感受同样值得被承接。' },
      { title: '仙人掌', emoji: '🌵', headline: '外壳坚硬，内里温柔', content: '你不喜欢示弱，习惯自己处理一切。但适当的求助不是软弱，偶尔让别人靠近一点，你会轻松很多。' },
      { title: '樱花', emoji: '🌸', headline: '浪漫且珍惜当下', content: '你对美好事物敏感，容易共情也容易受伤。你的花期很长，别因为一次凋谢就否定整个春天。' },
      { title: '薄荷', emoji: '🌿', headline: '清醒、提神、自带凉意', content: '你看问题很清醒，讨厌拖泥带水。给关系和生活留一点"不较真"的空间，清醒之外也可以柔软。' },
      { title: '玫瑰', emoji: '🌹', headline: '热烈，也懂得保护自己', content: '你爱憎分明，对在意的事全情投入。你的刺不是缺点，是边界；学会对值得的人收刺，是你要练习的事。' },
      { title: '蒲公英', emoji: '🌬️', headline: '自由，向往远方', content: '你讨厌被束缚，总在寻找更大的世界。自由很好，但偶尔落地扎根，才能让飘着的种子真的长成花园。' },
    ],
  },
  animal: {
    title: '测一测你是什么小动物',
    emoji: '🐾',
    questions: [
      { q: '一群人在讨论，你通常？', options: ['先听，想清楚再开口', '主动带节奏', '只和熟的人聊', '偶尔插一句关键的话'] },
      { q: '你的理想周末状态？', options: ['睡到自然醒，慢慢来', '安排得满满当当', '随性，想到什么做什么', '和喜欢的人待在一起'] },
      { q: '突然接到一个没做过的新任务？', options: ['有点慌，先研究', '兴奋，马上动手', '找队友一起做', '先拖一拖再爆发'] },
    ],
    results: [
      { title: '猫', emoji: '🐱', headline: '独立、敏锐、有自己的节奏', content: '你不喜欢被安排，对环境和人的变化很敏感。你的课题是学会主动表达需求，而不是等别人猜。' },
      { title: '狗', emoji: '🐶', headline: '忠诚、热烈、重感情', content: '你对认定的人和事掏心掏肺。记得把这份忠诚也分给自己一点，你的需求同样重要。' },
      { title: '狐狸', emoji: '🦊', headline: '聪明、灵活、总能找到出路', content: '你反应快、点子多，是团队里的解题者。偶尔放下"必须聪明"的包袱，笨一点也没关系。' },
      { title: '熊猫', emoji: '🐼', headline: '温和、讨喜、内心强大', content: '你看起来软软的，其实有自己的坚持。你值得被好好照顾，别总把自己排在最后。' },
      { title: '鹰', emoji: '🦅', headline: '目标感强，看得远', content: '你习惯从高处看全局，讨厌琐碎。落地执行时多给自己一点耐心，翅膀也需要歇脚。' },
      { title: '鹿', emoji: '🦌', headline: '优雅、警觉、内心细腻', content: '你对环境很敏感，容易想很多。练习把"别人的眼光"调小声，你的直觉其实很准。' },
      { title: '海豚', emoji: '🐬', headline: '聪明、友善、快乐感染力强', content: '你擅长让气氛变好，是大家的开心果。但你的低落也需要出口，别总笑着藏起自己。' },
      { title: '树懒', emoji: '🦥', headline: '慢，但有自己的哲学', content: '你讨厌被催，相信慢慢来比较快。你的节奏没有错，只要方向在动，慢一点也是前进。' },
    ],
  },
  career: {
    title: '测一测你的职业方向倾向',
    emoji: '🧭',
    questions: [
      { q: '做哪类事让你最有成就感？', options: ['亲手做出一个东西', '研究透一个复杂问题', '帮别人解决问题', '把一个想法从零到一'] },
      { q: '你更擅长？', options: ['动手和执行', '分析和逻辑', '沟通和共情', '创意和表达'] },
      { q: '你理想的工作环境？', options: ['稳定有秩序', '自由有空间', '和人有大量互动', '充满挑战和变化'] },
    ],
    results: [
      { title: '实干型', emoji: '🔧', headline: '把事情做出来，是你的语言', content: '你适合结果导向、有明确交付的岗位：工程、运营、制造、执行类。成就感来自"做成了"，而非"想通了"。' },
      { title: '研究型', emoji: '🔬', headline: '你喜欢把问题想透', content: '你适合分析和深度思考型工作：研究、数据、策略、技术类。给自己找有难度的问题，你会越来越值钱。' },
      { title: '助人型', emoji: '🤝', headline: '你的能量来自帮助别人', content: '你适合与人深度互动的工作：教育、咨询、医疗、客户成功。注意建立边界，助人之前先给自己充电。' },
      { title: '创造型', emoji: '🎨', headline: '你靠想法和表达吃饭', content: '你适合创意与表达类工作：内容、设计、产品、品牌。把灵感变成作品集，你的能力需要被看见。' },
      { title: '开创型', emoji: '🚀', headline: '你天生适合从零到一', content: '你适合创业型、开拓型岗位：新业务、市场拓展、项目负责人。你的抗压能力强，记得带上一支靠谱的队伍。' },
      { title: '秩序型', emoji: '🗂️', headline: '你把混乱变有序', content: '你适合需要细致和可靠的岗位：财务、行政、风控、质量。你的价值在"靠谱"二字，这是最稀缺的品质之一。' },
    ],
  },
  energy: {
    title: '今日能量提示',
    emoji: '✨',
    questions: [], // 无题目，直接基于画像生成
    results: [],
  },
}

/** 读取自定义题库（沉淀的测验；文件不存在返回 {}） */
export function loadCustomQuizzes() {
  if (customCache) return customCache
  try {
    customCache = JSON.parse(fs.readFileSync(CUSTOM_PATH, 'utf8'))
  } catch {
    customCache = {}
  }
  return customCache
}

/** 沉淀一个新测验到自定义题库文件（幂等：id 已存在则跳过） */
export function saveCustomQuiz(quizId, quiz) {
  const all = loadCustomQuizzes()
  if (all[quizId]) return false
  if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length || !Array.isArray(quiz.results) || !quiz.results.length) return false
  all[quizId] = {
    title: String(quiz.title || '').slice(0, 30),
    emoji: String(quiz.emoji || '🎲').slice(0, 4),
    questions: quiz.questions.slice(0, 5).map((q) => ({ q: String(q.q || '').slice(0, 60), options: (q.options || []).slice(0, 6).map((o) => String(o).slice(0, 20)) })),
    results: quiz.results.slice(0, 8).map((r) => ({ title: String(r.title || '').slice(0, 12), emoji: String(r.emoji || '✨').slice(0, 4), headline: String(r.headline || '').slice(0, 30), content: String(r.content || '').slice(0, 120) })),
    custom: true,
  }
  try {
    fs.mkdirSync(path.dirname(CUSTOM_PATH), { recursive: true })
    fs.writeFileSync(CUSTOM_PATH, JSON.stringify(all, null, 2))
  } catch (e) {
    console.warn('[quizzes] 自定义题库落盘失败：', e.message)
  }
  return true
}

/** 完整题库 = 内置 + 自定义沉淀 */
export function allQuizzes() {
  return { ...QUIZZES, ...loadCustomQuizzes() }
}

/** 题库标题清单（供建议卡/提示词引用） */
export function quizCatalog() {
  return Object.entries(allQuizzes())
    .filter(([, qz]) => qz.questions && qz.questions.length)
    .map(([id, qz]) => ({ id, title: qz.title, emoji: qz.emoji }))
}

/**
 * Mock 模式通用测验模板：题库没有的主题用规则生成 3 题 + 6 结果并沉淀。
 * 题目是通用状态映射题（不含诊断），主题词只出现在标题与结果收尾里。
 */
export function makeGenericQuiz(topic) {
  const t = String(topic || '').replace(/测一测|测测|测试|我(是不是|的)/g, '').trim().slice(0, 8) || '状态'
  return {
    title: `测一测我的${t}`,
    emoji: '🎲',
    questions: [
      { q: `提到「${t}」，你第一反应是？`, options: ['有点在意', '无所谓', '想弄清楚', '看心情'] },
      { q: '最近一次遇到相关的事，你通常？', options: ['先观察再行动', '直接冲', '找人聊聊', '能拖就拖'] },
      { q: '你希望这件事变得？', options: ['更稳一点', '更有趣', '更清楚', '更轻松'] },
    ],
    results: [
      { title: '观察派', emoji: '👀', headline: '你习惯先看清楚再动', content: `面对「${t}」，你倾向先收集信息再做决定。这个习惯很好，只要别让"观察"变成"拖延"。` },
      { title: '行动派', emoji: '⚡', headline: '你的第一反应是动手', content: `你在「${t}」上很有冲劲。记得在行动间隙回头看看方向，冲得快也要冲得对。` },
      { title: '连接派', emoji: '🫂', headline: '你习惯先找人聊聊', content: `对你来说，「${t}」是需要有人一起面对的事。把感受说出来，你已经完成了一半。` },
      { title: '节奏派', emoji: '🌊', headline: '你相信事情有自己的节奏', content: `你不喜欢被「${t}」推着走。给事情一点时间发酵，同时也给自己设一个"再想想"的期限。` },
    ],
    custom: true,
  }
}

// 供 prompt 内嵌的紧凑题库（含自定义沉淀）
export function quizSummaryForPrompt() {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(allQuizzes()).map(([id, qz]) => [
        id,
        {
          title: qz.title,
          emoji: qz.emoji,
          questions: (qz.questions || []).map((q) => ({ q: q.q, options: q.options })),
          results: (qz.results || []).map((r) => ({ title: r.title, emoji: r.emoji, headline: r.headline, content: r.content })),
        },
      ])
    )
  )
}

// mock 状态机用：按答案确定性选择结果
export function pickResult(quizId, answers) {
  const qz = allQuizzes()[quizId]
  if (!qz || !qz.results?.length) return null
  let h = 0
  for (const a of answers || []) {
    for (const c of String(a)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  }
  return qz.results[h % qz.results.length]
}
