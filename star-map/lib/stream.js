// 人生事件流（docs/23 §3.4）：日记、对话、情绪点选统一为带时间戳事件，
// 日报按 6:00 划日时间窗聚合。formatStream 把一天的事件序列化为给报告提示词的文本。

export function formatStream(events = []) {
  return (events || [])
    .map((e) => {
      const d = e.data || {}
      if (e.kind === 'chat_turn') {
        const who = d.role === 'user' ? '用户' : '小星'
        return `${who}：${String(d.text || '').trim()}`
      }
      if (e.kind === 'diary_entry') {
        const mood = Array.isArray(d.mood) && d.mood.length ? `（心情：${d.mood.join('、')}）` : ''
        return `日记：${String(d.text || '').trim()}${mood}`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/** 事件流一天的情绪点选集合（供心情卡兜底） */
export function streamEmotions(events = []) {
  const out = []
  for (const e of events || []) {
    const mood = e.data?.mood
    if (Array.isArray(mood)) out.push(...mood)
  }
  return out
}
