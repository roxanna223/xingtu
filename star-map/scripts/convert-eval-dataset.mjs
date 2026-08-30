// 心理陪伴对话评测集格式转换器
// 把常见开源数据集（CPsyCounE / SoulChatCorpus / ShareGPT 风格）统一转成 eval-dialogue.mjs 可用的 JSONL。
//
// 用法：
//   node scripts/convert-eval-dataset.mjs <input.json|input.jsonl> [output.jsonl] [--format=auto|cpsycoun|soulchat|sharegpt]
//
// 输入支持：
// - .jsonl：每行一个样本；
// - .json：单个对象（含 conversations 字段）或样本数组；
//
// 输出每行：{ id, scenario?, conversation: [{ role:'user'|'assistant', content }] }

import fs from 'node:fs'
import path from 'node:path'

const inputPath = process.argv[2]
const outputPath = process.argv[3] || path.join(path.dirname(inputPath || '.'), 'dialogue-eval-converted.jsonl')
const formatFlag = process.argv.find((a) => a.startsWith('--format='))?.slice('--format='.length) || 'auto'

if (!inputPath) {
  console.error('用法：node scripts/convert-eval-dataset.mjs <input.json|input.jsonl> [output.jsonl] [--format=auto|cpsycoun|soulchat|sharegpt]')
  process.exit(1)
}
if (!fs.existsSync(inputPath)) {
  console.error(`文件不存在：${inputPath}`)
  process.exit(1)
}

const USER_ROLES = new Set(['user', 'human', 'client', 'visitor', 'patient', '来访者', '用户'])
const BOT_ROLES = new Set(['assistant', 'gpt', 'counselor', 'therapist', 'counsellor', 'star', '小星', '咨询师'])

function detectRole(s) {
  const low = String(s || '').toLowerCase().trim()
  if (USER_ROLES.has(low)) return 'user'
  if (BOT_ROLES.has(low)) return 'assistant'
  return null
}

function normalizeRole(s, index) {
  const r = detectRole(s)
  if (r) return r
  // 无角色时按位置推断：偶数 user，奇数 assistant
  return index % 2 === 0 ? 'user' : 'assistant'
}

function normalizeMessages(raw, fmt) {
  if (!Array.isArray(raw)) return null

  // ShareGPT / CPsyCounE 风格：{ speaker/role/from, value/text/content } 对象数组
  if (raw.every((x) => x && typeof x === 'object')) {
    return raw.map((m, i) => {
      const roleKey = ['speaker', 'role', 'from', 'type'].find((k) => m[k] !== undefined)
      const role = roleKey ? normalizeRole(m[roleKey], i) : normalizeRole(null, i)
      const contentKey = ['value', 'text', 'content', 'utterance', 'sentence'].find((k) => m[k] !== undefined)
      return { role, content: String(contentKey ? m[contentKey] : '') }
    })
  }

  // SoulChatCorpus 等 [[q,a],[q,a],...] 成对数组
  if (raw.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string')) {
    const messages = []
    for (const [q, a] of raw) {
      messages.push({ role: 'user', content: String(q || '') })
      messages.push({ role: 'assistant', content: String(a || '') })
    }
    return messages
  }

  // 纯字符串数组，按顺序交替
  if (raw.every((x) => typeof x === 'string')) {
    return raw.map((t, i) => ({ role: normalizeRole(null, i), content: String(t || '') }))
  }

  return null
}

function normalizeOne(item, fmt) {
  if (!item || typeof item !== 'object') return null
  let id = item.id || item.session_id || item.dialogue_id || item.conv_id || `conv-${Math.random().toString(36).slice(2, 8)}`
  let scenario = item.scenario || item.background || item.instruction || item.title || ''
  let conversation = null

  const format = fmt === 'auto' ? guessFormat(item) : fmt

  if (format === 'cpsycoun') {
    const dia = item.dialogue || item.conversation || item.messages || item.turns
    conversation = normalizeMessages(dia, fmt)
  } else if (format === 'soulchat') {
    // SoulChatCorpus 常见字段：instruction + conversations[[q,a],...] 或 conversation 数组
    const dia = item.conversations || item.conversation || item.dialogue || item.messages
    conversation = normalizeMessages(dia, fmt)
  } else if (format === 'sharegpt') {
    const dia = item.conversations || item.conversation || item.messages
    conversation = normalizeMessages(dia, fmt)
  } else {
    // auto fallback：优先找已知字段
    const dia = item.conversation || item.conversations || item.dialogue || item.messages || item.turns || item.utterances
    conversation = normalizeMessages(dia, fmt)
    // 若没找到，但本身已是消息数组
    if (!conversation && Array.isArray(item)) conversation = normalizeMessages(item, fmt)
  }

  if (!conversation || conversation.length < 2) return null
  return { id, scenario, conversation }
}

function guessFormat(item) {
  if (item.dialogue_id !== undefined || item.dialogue !== undefined) return 'cpsycoun'
  if (item.conversations !== undefined && Array.isArray(item.conversations) && item.conversations.every((x) => Array.isArray(x))) return 'soulchat'
  if (item.conversations !== undefined) return 'sharegpt'
  return 'sharegpt'
}

function* readInput(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jsonl') {
    const text = fs.readFileSync(filePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t) continue
      try {
        yield JSON.parse(t)
      } catch {
        console.warn('跳过非法 JSONL 行')
      }
    }
  } else {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (Array.isArray(raw)) {
      for (const item of raw) yield item
    } else if (raw.conversations && Array.isArray(raw.conversations)) {
      for (const item of raw.conversations) yield item
    } else if (raw.data && Array.isArray(raw.data)) {
      for (const item of raw.data) yield item
    } else {
      yield raw
    }
  }
}

const out = []
let skipped = 0
let count = 0
for (const item of readInput(inputPath)) {
  count++
  const norm = normalizeOne(item, formatFlag)
  if (!norm) {
    skipped++
    continue
  }
  out.push(norm)
}

if (!out.length) {
  console.error('未转换出任何有效对话，请检查输入格式')
  process.exit(1)
}

fs.writeFileSync(outputPath, out.map((x) => JSON.stringify(x)).join('\n') + '\n')
console.log(`输入样本：${count}，成功转换：${out.length}，跳过：${skipped}`)
console.log(`已写入：${outputPath}`)
console.log(`\n可用以下命令跑裁判：`)
console.log(`  node scripts/eval-dialogue.mjs ${outputPath}`)
