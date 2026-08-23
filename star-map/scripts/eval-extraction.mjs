// 抽取准确率评测：对 data/eval-set.json 的 10 条人工标注样本跑引擎打分
// 用法：npm run eval
// 引擎：有 DEEPSEEK_API_KEY 走 LLM（评分用 LLM 裁判做语义对齐），否则 Mock 规则版（关键词规则评分）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mockExtract, callLLM, parseJson } from '../lib/engine.js'
import { extractMessages } from '../lib/prompts.js'

// 极简 .env 加载（脚本不经 Next.js 启动，不会自动读 .env）
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const setPath = path.join(process.cwd(), '..', 'data', 'eval-set.json')
const set = JSON.parse(fs.readFileSync(setPath, 'utf8'))
const llmMode = !!process.env.DEEPSEEK_API_KEY
console.log(`评测集：${set.length} 条人工标注样本`)
console.log(`引擎模式：${llmMode ? 'LLM（DeepSeek）' : 'Mock 规则版（基线）'}`)
console.log(llmMode ? '评分方式：LLM 裁判语义对齐（Mock 模式仍用关键词规则评分）\n' : '评分方式：关键词规则\n')

async function judge(gold, predicted) {
  const sys = `你是抽取结果评测裁判。给 gold 标注列表与 predicted 预测主题列表，判断每条 gold 是否被某条预测主题覆盖。
判定标准：
- 覆盖 = 两者描述同一主题（语义一致即可，名称不必相同；允许一条预测覆盖多条 gold，也允许一条 gold 无覆盖）；
- domainCorrect = 覆盖时两者生活域是否一致；
- emotionCorrect = 覆盖时预测情绪与该 gold 情绪语义是否等价（八情绪：焦虑/疲惫/迷茫/愤怒/平静/期待/低落/充实）。
只输出 JSON：{"pairs":[{"goldKw":"失眠","matched":true,"domainCorrect":true,"emotionCorrect":false}]}`
  const user = `gold: ${JSON.stringify(gold)}
predicted: ${JSON.stringify(predicted.map((p) => ({ name: p.name, domain: p.domain, emotion: p.emotion, quote: p.quote })))}`
  try {
    const raw = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: user }])
    const parsed = parseJson(raw)
    if (parsed && Array.isArray(parsed.pairs)) return parsed.pairs
  } catch (e) {
    console.warn('judge 失败，降级规则评分：', e.message)
  }
  return null
}

function ruleMatch(goldKw, predicted) {
  return (
    predicted.find((t) => String(t.name || '').includes(goldKw)) ||
    predicted.find((t) => String(t.quote || '').includes(goldKw) && t.domain === goldKw?.domain) ||
    null
  )
}

let domainHit = 0, domainN = 0
let emotionHit = 0, emotionN = 0
let crisisHit = 0, crisisN = 0

for (const s of set) {
  const record = { date: s.date, freeText: s.freeText, q1: s.q1, q2: s.q2, q3: s.q3 }
  let result
  if (llmMode) {
    try {
      const raw = await callLLM(extractMessages(record, []))
      const parsed = parseJson(raw)
      result = parsed && Array.isArray(parsed.topics)
        ? { topics: parsed.topics, crisis: !!parsed.crisis }
        : mockExtract(record)
    } catch (e) {
      console.warn(`#${s.id} LLM 失败降级 Mock：${e.message}`)
      result = mockExtract(record)
    }
  } else {
    result = mockExtract(record)
  }

  if (typeof s.crisis === 'boolean') {
    crisisN++
    if (!!result.crisis === !!s.crisis) crisisHit++
  }

  let pairs = null
  if (llmMode) pairs = await judge(s.gold, result.topics)

  const line = []
  for (const g of s.gold) {
    let matched = null
    let domainOk = false
    let emotionOk = false
    if (pairs) {
      const p = pairs.find((x) => x.goldKw === g.kw)
      if (p && p.matched) {
        matched = result.topics.find((t) => String(t.name || '').includes(g.kw)) ||
          result.topics.find((t) => (t.quote || '').includes(g.kw)) || result.topics[0]
        domainOk = !!p.domainCorrect
        emotionOk = !!p.emotionCorrect
      }
    } else {
      matched = ruleMatch(g.kw, result.topics)
      if (matched) {
        domainOk = matched.domain === g.domain
        emotionOk = matched.emotion === g.emotion
      }
    }
    domainN++
    if (matched) {
      if (domainOk) domainHit++
      emotionN++
      if (emotionOk) emotionHit++
      line.push(`${g.kw}→${matched.name}[${matched.domain}/${matched.emotion}]${domainOk && emotionOk ? '✓' : (domainOk ? '域✓情✗' : '✗')}`)
    } else {
      emotionN++
      line.push(`${g.kw}→未覆盖 ✗`)
    }
  }
  console.log(
    `#${String(s.id).padStart(2)} crisis=${s.crisis ? 'Y' : '-'}（检出:${result.crisis ? 'Y' : '-'}） ${line.join(' | ')}`
  )
}

const pct = (h, n) => (n ? ((h / n) * 100).toFixed(1) + '%' : '-')
console.log(`\n=== 汇总（n=${set.length}）===`)
console.log(`领域准确率：${pct(domainHit, domainN)}（${domainHit}/${domainN}）`)
console.log(`情绪准确率：${pct(emotionHit, emotionN)}（${emotionHit}/${emotionN}）`)
console.log(`危机识别：${pct(crisisHit, crisisN)}（${crisisHit}/${crisisN}）`)
console.log(`\n阈值参考（见 docs/05_eval_plan_v0.1.md）：领域 ≥85%，情绪 ≥75%，危机召回 100%（宁误报不漏报）`)
