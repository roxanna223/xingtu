// 主题合并整理：把碎片化的主题列表交给 LLM 生成"同一对象合并方案"，再程序化归并。
// 用途：批量导入后画像主题碎片化时的一次性整理（如"跑步/夜跑/晨跑"→"跑步"）。
// 用法：npm run consolidate （或 node scripts/consolidate-topics.mjs [dry]）
// 带参数 dry：只打印合并方案，不写盘。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProfile, writeProfile } from '../lib/store.js'
import { callLLM, parseJson } from '../lib/engine.js'

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const dry = process.argv[2] === 'dry'
const profile = readProfile()
const topics = profile.topics || []

const sys = `你是「星图」产品的画像整理助手。下面是一个用户长期画像的主题列表（每条为 id|名称，同一生活域内）。这些主题来自每天的记录抽取，因为归并规则严格，出现了严重碎片化：同一个对象/同一件事/同一活动被拆成了多条。

你的任务：输出应合并的主题组。这是**事后整理**，判定标准比日常抽取更宽松：

判定示例（这些都是应当合并的）：
- 同一活动的不同叫法："跑步/夜跑/傍晚跑步/新年晨跑" → 一组；
- 同一系列事件："写七月复盘/写八月复盘/写九月复盘/写月度小结/写四月复盘/写五月复盘/写三月复盘" → 一组；"写半年复盘/写年度总结/写年终总结" → 一组；
- 同一对象的不同侧面："妈妈生病/妈妈康复" → 一组；"和女友吵架/和女友和好" → 一组；
- 同一个项目的不同阶段："项目进展/项目改版/项目上线测试版/项目付费版/项目用户破五百/项目日活创新高" → 一组（只要都指"我自己的那个项目"）；
- 同一类日常习惯："早点睡/调整作息/继续早起" → 一组；
- 同一事件的计划与执行："写付费方案/项目付费版" → 一组。

目标：让最终主题数大致落在原数量的 1/3 ~ 1/2，主题有清晰脉络（如"跑步""项目""和爸妈的关系""和女友的关系""复盘总结"）。

约束：
1. **不得跨生活域合并**（domain 必须相同）；
2. 明显不同对象绝不合并（"爸妈"与"女友"、"工作"与"项目"绝不合并）；
3. 输出 JSON：{"groups":[["id1","id2"],["id3","id4","id5"]]}，groups 内是应合并的主题 id 数组；未被列出的主题保持独立。`

let groups = []

// 按生活域分块调用（大 payload 请求在 API 侧易挂起/超时；小块更稳，失败只重试本块）
const domainOrder = ['事业', '关系', '自我', '健康', '财务', '成长']
const chunks = []
for (const domain of domainOrder) {
  const inDomain = topics.filter((t) => t.domain === domain)
  if (!inDomain.length) continue
  if (domain === '事业' && inDomain.length > 80) {
    const sorted = [...inDomain].sort((a, b) => b.freq - a.freq)
    chunks.push({ domain, part: 'A（高频）', topics: sorted.slice(0, 80) })
    chunks.push({ domain, part: 'B（低频）', topics: sorted.slice(80) })
  } else {
    chunks.push({ domain, part: '', topics: inDomain })
  }
}

async function callLLMWithTimeout(messages, ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const cfg = {
      key: process.env.DEEPSEEK_API_KEY,
      base: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    }
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timer)
  }
}

for (const chunk of chunks) {
  console.log(`[chunk] ${chunk.domain}${chunk.part} 共 ${chunk.topics.length} 条，开始…`)
  const listing = chunk.topics.map((t) => `${t.id}|${t.name}`).join('\n')
  const user = `生活域：${chunk.domain}${chunk.part ? ` ${chunk.part}` : ''}（共 ${chunk.topics.length} 条）\n${listing}\n\n请输出 JSON：{"groups":[["id1","id2"],...]}，每组最多 8 个 id，输出尽量紧凑。`
  let ok = false
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      console.log(`[chunk] ${chunk.domain}${chunk.part} 第 ${attempt + 1} 次请求…`)
      const raw = await callLLMWithTimeout(
        [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        120000
      )
      console.log(`[chunk] ${chunk.domain}${chunk.part} 第 ${attempt + 1} 次返回 ${raw.length} 字符`)
      const parsed = parseJson(raw)
      if (parsed && Array.isArray(parsed.groups)) {
        groups.push(...parsed.groups)
        ok = true
      } else {
        console.warn(`[${chunk.domain}${chunk.part}] 第 ${attempt + 1} 次解析失败`)
      }
    } catch (e) {
      console.warn(`[${chunk.domain}${chunk.part}] 第 ${attempt + 1} 次失败：${e.message}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (!ok) console.error(`[${chunk.domain}${chunk.part}] 多次失败，跳过该块`)
}

// 校验：id 必须存在、组内域一致、无重复
const idSet = new Set(topics.map((t) => t.id))
const seen = new Set()
const valid = []
for (const g of groups) {
  const members = topics.filter((t) => g.includes(t.id))
  if (members.length < 2) continue
  const domains = new Set(members.map((m) => m.domain))
  if (domains.size > 1) continue
  const ids = members.map((m) => m.id)
  if (ids.some((i) => seen.has(i))) continue
  ids.forEach((i) => seen.add(i))
  valid.push(members)
}

console.log(`合并方案：${valid.length} 组，共 ${valid.reduce((a, g) => a + g.length, 0)} 个主题将归并。`)
for (const g of valid) {
  console.log(`  → [${g.map((m) => m.name).join(' + ')}]（${g[0].domain}）`)
}

if (dry) process.exit(0)

// 程序化归并
const survivorOf = new Map() // deadId -> survivorId（以及每组 survivor）
const deadIds = new Set()
for (const g of valid) {
  // 幸存者：freq 最大；相同取 firstSeen 最早
  const survivor = [...g].sort((a, b) => (b.freq - a.freq) || a.firstSeen.localeCompare(b.firstSeen))[0]
  survivorOf.set(survivor.id, survivor.id)
  for (const m of g) {
    if (m.id === survivor.id) continue
    deadIds.add(m.id)
    survivorOf.set(m.id, survivor.id)
    survivor.freq += m.freq || 0
    survivor._polSum = (survivor._polSum || 0) + (m._polSum || 0)
    survivor._polCount = (survivor._polCount || 0) + (m._polCount || 0)
    if (survivor._polCount) survivor.polarity = Math.round((survivor._polSum / survivor._polCount) * 100) / 100
    if ((m.firstSeen || '') < (survivor.firstSeen || '')) survivor.firstSeen = m.firstSeen
    if ((m.lastActive || '') > (survivor.lastActive || '')) survivor.lastActive = m.lastActive
    survivor.quotes = [...new Set([...(survivor.quotes || []), ...(m.quotes || [])])].slice(-8)
  }
}
profile.topics = topics.filter((t) => !deadIds.has(t.id))

// 边重映射：死节点 → 幸存者；删自环；重复边权重合并（上限 1）
const newEdges = []
const edgeKey = (a, b) => (a < b ? `${a}→${b}` : `${b}→${a}`)
const edgeMap = new Map()
for (const e of profile.edges || []) {
  const s = survivorOf.get(e.source) || e.source
  const t = survivorOf.get(e.target) || e.target
  if (s === t) continue
  const k = edgeKey(s, t)
  const prev = edgeMap.get(k)
  if (prev) {
    prev.weight = Math.min(1, Math.round(((prev.weight || 0) + (e.weight || 0)) * 100) / 100)
  } else {
    const ne = { source: s, target: t, weight: e.weight || 0.3 }
    edgeMap.set(k, ne)
    newEdges.push(ne)
  }
}
profile.edges = newEdges

writeProfile(profile)
console.log(`\n归并完成：主题 ${topics.length} → ${profile.topics.length}，边 ${(profile.edges || []).length}。`)
console.log('高频主题 Top 15：')
console.log(
  [...profile.topics]
    .sort((a, b) => b.freq - a.freq)
    .slice(0, 15)
    .map((t) => `${t.name}(${t.domain}/${t.emotion}/x${t.freq})`)
    .join('\n')
)
