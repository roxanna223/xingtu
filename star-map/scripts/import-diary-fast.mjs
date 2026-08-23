// 并发版批量导入：与 import-diary.mjs 解析逻辑一致，但用 N 路并发做 LLM 抽取，
// 合并进画像的逻辑是同步的（单线程内原子执行），并发只发生在 await LLM 阶段，因此安全。
// 用法：npm run import-fast ../data/测试数据-20个月日记.md [并发数，默认6]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProfile, writeProfile, readDays, writeDays } from '../lib/store.js'
import { extractAndMerge } from '../lib/engine.js'
import { cohortFor } from '../lib/cohort.js'

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const mdPath = process.argv[2] || path.join(process.cwd(), '..', 'data', '我的7天记录.md')
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.argv[3]) || 6))
if (!fs.existsSync(mdPath)) {
  console.error(`找不到文件：${mdPath}`)
  process.exit(1)
}
const md = fs.readFileSync(mdPath, 'utf8')
const today = () => new Date().toISOString().slice(0, 10)
const clean = (s) => String(s || '').replace(/[_□× ]/g, '').trim()

/* Day1 引导信息（与 import-diary.mjs 一致） */
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

/* 解析所有 Day 分节 */
const records = []
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

  if (!freeText) continue
  records.push({ date, freeText, q1: q(1), q2: q(2), q3: q(3) })
}

const days = readDays()
let imported = 0
let fallbackCount = 0
let cursor = 0
const t0 = Date.now()

/* 并发 worker：LLM 阶段并发，合并阶段（extractAndMerge 内同步尾部）天然串行 */
async function worker(id) {
  for (;;) {
    const idx = cursor++
    if (idx >= records.length) return
    const record = records[idx]
    try {
      const result = await extractAndMerge(record, profile)
      const daysIdx = days.findIndex((d) => d.date === record.date)
      if (daysIdx >= 0) days[daysIdx] = record
      else days.push(record)
      imported++
      if (result && result._mockFallback) fallbackCount++
      if (!result || result._mockFallback) {
        console.log(`[w${id}] ${record.date}：主题 ${result?.topics?.length ?? '?'} 条（Mock 兜底）`)
      } else {
        console.log(`[w${id}] ${record.date}：主题 ${result.topics.length} 条`)
      }
      if (imported % 20 === 0) {
        const el = ((Date.now() - t0) / 1000).toFixed(0)
        console.log(`—— 进度 ${imported}/${records.length}，用时 ${el}s`)
      }
    } catch (e) {
      console.warn(`[w${id}] ${record.date} 失败：${e.message}`)
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)))

days.sort((a, b) => a.date.localeCompare(b.date))
writeProfile(profile)
writeDays(days)

console.log('\n完成。')
console.log(JSON.stringify({
  concurrency: CONCURRENCY,
  importedDays: imported,
  mockFallbackDays: fallbackCount,
  totalDays: days.length,
  cohort: profile.user.cohort,
  careerStage: profile.user.careerStage,
  topicCount: profile.topics.length,
  edgeCount: profile.edges.length,
  emotionSeriesCount: (profile.emotionSeries || []).length,
  personaTier: profile.user.personaTier,
  topics: profile.topics.map((t) => `${t.name}(${t.domain}/${t.emotion}/x${t.freq})`),
}, null, 2))
