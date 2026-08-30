// 行为信号采集与三层画像中的"行为层"
// 目标：根据用户的语言/行为/反馈，持续校正所有对话 Agent 的风格与内容（自迭代机制的数据基础）
// 当前为规则基线版；LLM 深度抽取（语言风格、价值观、回避主题）见 docs/07 的 roadmap

import { fakeTodayISO } from './clock.js'

const EMO_KW = ['焦虑', '疲惫', '迷茫', '愤怒', '平静', '期待', '低落', '充实', '累', '烦', '慌', '开心', '难过', 'emo']
const ABS_KW = ['为什么', '意义', '本质', '逻辑', '价值', '底层', '原因', '原理']

export function defaultBehavior() {
  return {
    msgCount: 0,
    avgLen: 0,
    emoRatio: 0,
    absRatio: 0,
    questionRatio: 0,
    openDepth: '中',
    updatedAt: '',
  }
}

// 滚动更新（规则版）：texts 为用户最近一轮的全部输入
export function updateBehavior(profile, texts = []) {
  const b = profile.behavior || defaultBehavior()
  for (const t of texts) {
    const s = String(t || '').trim()
    if (!s) continue
    const len = s.length
    b.avgLen = b.msgCount ? (b.avgLen * b.msgCount + len) / (b.msgCount + 1) : len
    b.msgCount += 1
    const emo = EMO_KW.filter((k) => s.includes(k)).length
    const abs = ABS_KW.filter((k) => s.includes(k)).length
    const segs = Math.max(1, Math.floor(len / 20))
    b.emoRatio = b.emoRatio * 0.7 + Math.min(1, emo / segs) * 0.3
    b.absRatio = b.absRatio * 0.7 + Math.min(1, abs / segs) * 0.3
    b.questionRatio = b.questionRatio * 0.7 + (/\?|？/.test(s) ? 1 : 0) * 0.3
  }
  b.openDepth = b.avgLen < 14 ? '浅' : b.avgLen < 45 ? '中' : '深'
  b.updatedAt = fakeTodayISO()
  profile.behavior = b
  return b
}

// 注入各 Agent Prompt 的行为摘要（短、结构化）
export function behaviorSummary(profile) {
  const b = profile.behavior || defaultBehavior()
  if (!b.msgCount) return '暂无行为数据（新用户）。'
  return [
    `语言风格：平均单条 ${Math.round(b.avgLen)} 字，偏${b.avgLen < 20 ? '简洁' : b.avgLen < 45 ? '中等' : '细腻'}表达`,
    `开放深度：${b.openDepth}（${b.openDepth === '浅' ? '偏好短平快，收束要更快' : b.openDepth === '深' ? '愿意展开，可多承接细节' : '节奏适中'}）`,
    `情绪表达频率：${b.emoRatio > 0.5 ? '高，优先共情' : '低，少猜测情绪、多问事实'}`,
    `抽象思考倾向：${b.absRatio > 0.3 ? '强，可讲原因与逻辑' : '弱，多给具体例子'}`,
    `提问频率：${b.questionRatio > 0.4 ? '常反问，可主动给参考选项' : '少，直接回应即可'}`,
  ].join('；')
}
