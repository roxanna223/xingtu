// 心情颜色：八种情绪各一个专属颜色（明面只讲"心情"，不做正负向标注）
export const EMO_COLORS = {
  焦虑: '#7b8cff',
  疲惫: '#5a6b8c',
  迷茫: '#8f9db8',
  愤怒: '#e05a5a',
  平静: '#6fc7a8',
  期待: '#f5c76a',
  低落: '#4a6fa5',
  充实: '#ff9a5c',
}

export const EMO_NAMES = Object.keys(EMO_COLORS)

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

// 从情绪轨迹文本（"事件（焦虑、充实）"）中统计八情绪出现次数
export function emotionCountsFromTrack(text) {
  const counts = {}
  const t = String(text || '')
  for (const em of EMO_NAMES) {
    const n = t.split(em).length - 1
    if (n > 0) counts[em] = n
  }
  return counts
}

// 按出现次数加权混合出"今日心情色"
export function mixEmotionColors(counts) {
  const entries = Object.entries(counts || {})
  if (!entries.length) return '#8f9db8' // 无数据时用雾灰（中性，不暗示）
  let r = 0, g = 0, b = 0, w = 0
  for (const [em, n] of entries) {
    const [er, eg, eb] = hexToRgb(EMO_COLORS[em] || '#8f9db8')
    r += er * n
    g += eg * n
    b += eb * n
    w += n
  }
  return rgbToHex(r / w, g / w, b / w)
}

// 规则版心情解读（LLM 模式下由模型生成更自然的解读）
export function mockMoodNote(counts) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1])
  if (!entries.length) return '今天还没有留下心情轨迹。'
  const [top, second] = entries
  return second
    ? `今天的颜色主要来自${top[0]}，掺着一点${second[0]}——两种心情都算数。`
    : `今天的颜色主要来自${top[0]}。`
}

// 解析心情轨迹文本（"事件（情绪、情绪）、事件（情绪）"）为结构化数组
export function parseTrackText(text) {
  if (!text) return []
  return String(text)
    .split('）、')
    .map((seg) => {
      const s = seg.trim()
      const m = s.match(/^(.+?)（(.+?)(?:）)?$/)
      if (!m) return null
      const emotions = m[2]
        .split(/[、，,]/)
        .map((x) => x.trim())
        .filter((x) => EMO_NAMES.includes(x))
      return { event: m[1].trim(), emotions }
    })
    .filter((x) => x && (x.event || x.emotions.length))
}
