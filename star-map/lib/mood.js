// 心情色命名体系：把情绪统计映射成「诗意颜色名 + 一句话短语 + 图案 + 渐变色」
// 用于「今日心情色」卡片：名字/短语给用户情绪共鸣，motif+hex 用于生成心情图（本地 SVG）
// 规则版兜底；有 MOONSHOT_API_KEY 时由 Kimi 按需增强（见 lib/moodImage.js）

export const MOTIFS = [
  'gem', 'flower', 'moon', 'sun', 'sprout', 'cloud', 'bolt',
  'compass', 'whale', 'tea', 'snow', 'rain', 'star', 'heart',
  'leaf', 'bubble', 'mountain',
]

// 每条：key=主情绪，alt=次情绪（可空），name=颜色名，line=短语，motif=图案，hex1/hex2=渐变
const MOODS = [
  { key: '平静', alt: '', name: '雾青', line: '慢慢回神', motif: 'moon', hex1: '#6fc7a8', hex2: '#8fd4bf' },
  { key: '期待', alt: '', name: '晨曦', line: '有光透进来', motif: 'sprout', hex1: '#f5c76a', hex2: '#ffd98e' },
  { key: '充实', alt: '', name: '落日橙', line: '今天没白过', motif: 'sun', hex1: '#ff9a5c', hex2: '#ffc08a' },
  { key: '焦虑', alt: '', name: '暮色蓝', line: '悬着的心', motif: 'cloud', hex1: '#7b8cff', hex2: '#a3b0ff' },
  { key: '疲惫', alt: '', name: '灰蓝', line: '只想躺平', motif: 'cloud', hex1: '#5a6b8c', hex2: '#8a99b5' },
  { key: '迷茫', alt: '', name: '雾灰', line: '看不清前路', motif: 'compass', hex1: '#8f9db8', hex2: '#b8c2d4' },
  { key: '愤怒', alt: '', name: '赤岩', line: '憋着一团火', motif: 'bolt', hex1: '#e05a5a', hex2: '#f08c8c' },
  { key: '低落', alt: '', name: '深海蓝', line: '有点沉', motif: 'whale', hex1: '#4a6fa5', hex2: '#7b97c4' },
  { key: '疲惫', alt: '平静', name: '琥珀玫瑰', line: '疲惫里的温', motif: 'gem', hex1: '#ffd9a0', hex2: '#a05a8c' },
  { key: '焦虑', alt: '期待', name: '薄荷气泡', line: '紧张又心动', motif: 'bubble', hex1: '#7fd4c1', hex2: '#f5c76a' },
  { key: '低落', alt: '平静', name: '海盐', line: '静水深流', motif: 'snow', hex1: '#9db8cc', hex2: '#6fa7b8' },
  { key: '充实', alt: '疲惫', name: '蜂蜜茶', line: '累但有点甜', motif: 'tea', hex1: '#e8b46a', hex2: '#c98a5e' },
  { key: '期待', alt: '平静', name: '新雪', line: '干净的期待', motif: 'snow', hex1: '#dce8f5', hex2: '#a8c8f0' },
  { key: '焦虑', alt: '疲惫', name: '铁灰', line: '累得发木', motif: 'cloud', hex1: '#6b7386', hex2: '#9aa0b0' },
  { key: '愤怒', alt: '低落', name: '灰烬', line: '气过之后', motif: 'bolt', hex1: '#8c6f7a', hex2: '#5a4a55' },
  { key: '平静', alt: '充实', name: '苔绿', line: '稳稳的满足', motif: 'leaf', hex1: '#8fb996', hex2: '#6fa878' },
  { key: '迷茫', alt: '期待', name: '远山紫', line: '想往前走', motif: 'mountain', hex1: '#a78bca', hex2: '#cbb8f0' },
  { key: '焦虑', alt: '低落', name: '雨夜', line: '又慌又沉', motif: 'rain', hex1: '#5a6b9e', hex2: '#3f4a6e' },
]

const NEUTRAL = { key: '', alt: '', name: '雾灰', line: '今天还没有心情颜色', motif: 'moon', hex1: '#8f9db8', hex2: '#b8c2d4' }

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// 情绪计数 → 心情卡对象（规则版，永远可用）
export function moodFromCounts(counts) {
  const sorted = Object.entries(counts || {}).sort((a, b) => b[1] - a[1])
  if (!sorted.length) return { ...NEUTRAL }
  const top = sorted[0][0]
  const sec = sorted.length > 1 ? sorted[1][0] : ''
  // 优先精确匹配「主+次」，其次只匹配主情绪
  let hit = MOODS.find((m) => m.key === top && m.alt === sec)
  if (!hit) hit = MOODS.find((m) => m.key === top && !m.alt)
  if (!hit) hit = MOODS.find((m) => m.key === top)
  if (!hit) hit = NEUTRAL
  const { key, alt, ...card } = hit
  return { ...card }
}

// 颜色 → 最近的心情卡（用于历史列表 / 周期报告的颜色点）
export function moodFromColor(hex) {
  if (!hex) return { ...NEUTRAL }
  const [r, g, b] = hexToRgb(hex)
  let best = NEUTRAL
  let bd = Infinity
  for (const m of MOODS) {
    const [mr, mg, mb] = hexToRgb(m.hex1)
    const d = (mr - r) ** 2 + (mg - g) ** 2 + (mb - b) ** 2
    if (d < bd) { bd = d; best = m }
  }
  const { key, alt, ...card } = best
  return { ...card }
}

// 校验/规范化 Kimi 返回的 motif
export function validMotif(m) {
  return MOTIFS.includes(m) ? m : 'gem'
}
