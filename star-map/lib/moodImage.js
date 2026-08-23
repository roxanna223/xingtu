// 心情卡「AI 设计」：用 Kimi（Moonshot）以最少 token 输出一个极简 JSON，
// 让心情卡的名字/短语/图案/配色更多样；本地再渲染成 SVG 图片（见 components/MoodCard.js）。
// 说明：Moonshot 官方 API 只提供对话补全，没有文生图接口——所以「图片」由本地 SVG 生成，
// Kimi 仅负责"设计参数"，做到按需调用、最省 token。无 key 或失败时自动回退规则表。

import { validMotif } from './mood.js'

function imgConfig() {
  return {
    key: process.env.MOONSHOT_API_KEY || '',
    base: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
    model: process.env.MOONSHOT_MODEL || 'kimi-k2.6',
    mock: !process.env.MOONSHOT_API_KEY,
  }
}

export function moodImageEnabled() {
  return !imgConfig().mock
}

export async function aiMoodCard({ counts = {}, topTopics = [], freeText = '' } = {}) {
  const cfg = imgConfig()
  if (cfg.mock) return null

  const sys = `你是「星图」产品的心情色彩命名师。根据用户今天的情绪统计，为TA设计一张"今日心情卡"。只输出一个 JSON 对象，不要任何解释。`
  const user = `情绪统计：${JSON.stringify(counts)}
活跃主题：${(topTopics || []).join('、') || '无'}
原话摘要：${String(freeText || '').slice(0, 80)}

输出 JSON，字段如下：
{"name":"2~4 字诗意颜色名","line":"4~8 字的一句话短语","motif":"图案","hex1":"#RRGGBB","hex2":"#RRGGBB"}

要求：
- name 像「琥珀玫瑰」「薄荷气泡」这种颜色+意象的组合；
- line 像「疲惫里的温」「静水深流」这种温柔的一句话；
- motif 只能从以下选一个：gem/flower/moon/sun/sprout/cloud/bolt/compass/whale/tea/snow/rain/star/heart/leaf/bubble/mountain；
- hex1、hex2 是一对和谐的新变色，颜色要贴合情绪。`

  try {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        max_tokens: 300,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const txt = data.choices?.[0]?.message?.content || ''
    const p = JSON.parse(txt)
    if (!p || !p.name || !p.hex1) return null
    return {
      name: String(p.name).slice(0, 8),
      line: String(p.line || '').slice(0, 16),
      motif: validMotif(p.motif),
      hex1: /^#[0-9a-fA-F]{6}$/.test(p.hex1) ? p.hex1 : '#8f9db8',
      hex2: /^#[0-9a-fA-F]{6}$/.test(p.hex2) ? p.hex2 : '#b8c2d4',
    }
  } catch {
    return null
  }
}
