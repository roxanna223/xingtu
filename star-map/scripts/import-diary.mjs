// 批量导入 7 天日记 → 画像抽取与主题归并
// 用法：npm run import [md路径]，默认 ../data/我的7天记录.md
// 引擎：有 DEEPSEEK_API_KEY 走 LLM，否则 Mock 规则版

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProfile, writeProfile, readDays, writeDays } from '../lib/store.js'
import { extractAndMerge } from '../lib/engine.js'
import { cohortFor } from '../lib/cohort.js'

// 极简 .env 加载（脚本不经 Next.js 启动，不会自动读 .env）
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const mdPath = process.argv[2] || path.join(process.cwd(), '..', 'data', '我的7天记录.md')
if (!fs.existsSync(mdPath)) {
  console.error(`找不到文件：${mdPath}`)
  process.exit(1)
}
const md = fs.readFileSync(mdPath, 'utf8')
const today = () => new Date().toISOString().slice(0, 10)
const clean = (s) => String(s || '').replace(/[_□× ]/g, '').trim()

/* Day1 引导信息 */
const birthRaw = md.match(/出生年月：\s*(.+)/)
const birth = birthRaw ? clean(birthRaw[1]) : ''
const stageRaw = md.match(/当前职业阶段：\s*(.+)/)
const stage = stageRaw ? clean(stageRaw[1]) : ''
const worries = [...md.matchAll(/^\s*\d\.\s*(.+)$/gm)]
  .map((m) => clean(m[1]))
  .filter((w) => w && !/^第?\s*\d+\s*件?$/.test(w))
  .slice(0, 3)

const profile = readProfile()
if (!profile.user?.cohort?.birthYearMonth && birth) profile.user.cohort = cohortFor(birth)
if (!profile.user.careerStage && stage) profile.user.careerStage = stage.slice(0, 20)

/* Day 分节解析 */
const dayRe = /## Day \d+：(\d{4})年(\d{1,2})月(\d{1,2})日/g
const matches = [...md.matchAll(dayRe)]
const firstDayDate = matches.length
  ? `${matches[0][1]}-${String(matches[0][2]).padStart(2, '0')}-${String(matches[0][3]).padStart(2, '0')}`
  : today()

for (const w of worries) {
  if (!profile.topics.some((t) => t.name === w)) {
    profile.topics.push({
      id: 't' + Math.random().toString(36).slice(2, 8),
      name: w.slice(0, 20),
      domain: '自我',
      emotion: '迷茫',
      polarity: -0.4,
      firstSeen: firstDayDate,
      lastActive: firstDayDate,
      freq: 1,
      quotes: [w.slice(0, 40)],
    })
  }
}

const days = readDays()
let imported = 0

for (let i = 0; i < matches.length; i++) {
  const m = matches[i]
  const date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  const section = md.slice(m.index, i + 1 < matches.length ? matches[i + 1].index : md.length)

  const freeMatch = section.match(/自由倾诉[^\n]*\n([\s\S]*?)(?:\*\*?收束三问|$)/)
  const freeText = (freeMatch ? freeMatch[1] : '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^>\s*/, '').trim())
    .filter((l) => l && !l.startsWith('---') && !l.includes('自由倾诉'))
    .join('\n')
    .trim()

  const q = (n) => {
    const qm = section.match(new RegExp(`- Q${n}[^\\n]*：\\s*([^\\n]+)`))
    return qm ? clean(qm[1]) : ''
  }

  if (!freeText) {
    console.log(`跳过 Day ${i + 1}（${date}）：无自由倾诉内容`)
    continue
  }
  const record = { date, freeText, q1: q(1), q2: q(2), q3: q(3) }
  const result = await extractAndMerge(record, profile)
  const idx = days.findIndex((d) => d.date === date)
  if (idx >= 0) days[idx] = record
  else days.push(record)
  imported++
  console.log(`导入 ${date}：主题 ${result.topics.length} 条${result.crisis ? ' ⚠️ 危机信号' : ''}`)
}

days.sort((a, b) => a.date.localeCompare(b.date))
writeProfile(profile)
writeDays(days)

console.log('\n完成。')
console.log(JSON.stringify({
  importedDays: imported,
  cohort: profile.user.cohort,
  careerStage: profile.user.careerStage,
  topicCount: profile.topics.length,
  edgeCount: profile.edges.length,
  personaTier: profile.user.personaTier,
  topics: profile.topics.map((t) => `${t.name}(${t.domain}/${t.emotion}/x${t.freq})`),
}, null, 2))
