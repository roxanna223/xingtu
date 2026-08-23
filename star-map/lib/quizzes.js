// 小星对话式测验题库（可扩展：往 QUIZZES 里加新类型即可）
// 题目为通用趣味心理映射题；LLM 主持测验时严格从题库取题，结果做个性化解读

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

// 供 prompt 内嵌的紧凑题库
export function quizSummaryForPrompt() {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(QUIZZES).map(([id, qz]) => [
        id,
        {
          title: qz.title,
          emoji: qz.emoji,
          questions: qz.questions.map((q) => ({ q: q.q, options: q.options })),
          results: qz.results.map((r) => ({ title: r.title, emoji: r.emoji, headline: r.headline, content: r.content })),
        },
      ])
    )
  )
}

// mock 状态机用：按答案确定性选择结果
export function pickResult(quizId, answers) {
  const qz = QUIZZES[quizId]
  if (!qz || !qz.results.length) return null
  let h = 0
  for (const a of answers || []) {
    for (const c of String(a)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  }
  return qz.results[h % qz.results.length]
}
