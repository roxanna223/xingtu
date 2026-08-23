// 意图识别与尺度判断（框架 docs/08 第 4、6 节的落地）
// 规则版基线；LLM 深度版见 roadmap

// 用户今日意图：advice=求助 / vent=纯倾诉 / none=中性记录
export function detectIntent(text) {
  const t = String(text || '')
  if (/怎么办|该不该|要不要|怎么选|怎么处理|如何|帮我想|给点建议|求建议|怎么改/.test(t)) return 'advice'
  if (/吐槽|无语|烦|生气|气死|服了|受不了|委屈|离谱|闹心|受不了/.test(t)) return 'vent'
  return 'none'
}

// 长期模式识别（近似）：同一主题的原话条数 ≥3 视为"反复出现的模式"（跨日多次记录）
export function patternTopics(profile) {
  return (profile.topics || [])
    .filter((t) => (t.quotes || []).length >= 3)
    .map((t) => t.name)
}
