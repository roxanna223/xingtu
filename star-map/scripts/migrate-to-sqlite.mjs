// JSON → SQLite 迁移(方案 docs/15 §5)
// 用法: node scripts/migrate-to-sqlite.mjs <anning账号新密码(至少8位)> [--force]
//  - 迁移 data/profile.json + days.json + chats.json 到 SQLite(users/profiles/days/chats)
//  - anning 保留为演示账号(密码在此设置,部署后记录到文档)
//  - 幂等:已迁移则跳过;--force 删除 anning 后重迁
//  - 成功后旧 JSON 移入 data/legacy-json/
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDB, closeDB } from '../lib/db.js'

const DATA_DIR = path.join(process.cwd(), 'data')
const newPassword = process.argv[2]
const force = process.argv.includes('--force')
if (!newPassword || newPassword.length < 8) {
  console.error('用法: node scripts/migrate-to-sqlite.mjs <anning账号新密码(至少8位)> [--force]')
  process.exit(1)
}

function readJson(name) {
  const p = path.join(DATA_DIR, name)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

const profile = readJson('profile.json')
if (!profile) {
  console.error('data/profile.json 不存在,无需迁移(全新部署请直接用 seed-admin + 邀请码注册)')
  process.exit(1)
}

const db = getDB()

// 幂等检查
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('anning')
if (existing && !force) {
  console.log('已存在账号 anning,迁移跳过(如需重迁加 --force)')
  closeDB()
  process.exit(0)
}
if (existing && force) {
  db.prepare('DELETE FROM users WHERE id = ?').run(existing.id)
  console.log('--force: 已删除旧 anning,重新迁移')
}

const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

const u = profile.user || {}
const ts = new Date().toISOString()
const cohort = u.cohort && typeof u.cohort === 'object' && u.cohort.birthYearMonth ? u.cohort : null

db.exec('BEGIN')
try {
  const r = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, birth_date, star_sign, star_symbol, cohort, career_stage, persona_tier, created_at)
       VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'anning',
      hashPassword(newPassword),
      u.birthDate ? String(u.birthDate).slice(0, 10) : null,
      u.starSign || null,
      u.starSymbol || null,
      cohort ? JSON.stringify(cohort) : null,
      u.careerStage || '',
      u.personaTier || 'logical',
      ts
    )
  const userId = Number(r.lastInsertRowid)

  db.prepare(
    `INSERT INTO profiles (user_id, topics, edges, feedback_log, emotion_series, reports, period_reports, behavior, last_report, opener_idx, last_openers, adapt_log, generating, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    JSON.stringify(profile.topics ?? []),
    JSON.stringify(profile.edges ?? []),
    JSON.stringify(profile.feedbackLog ?? []),
    JSON.stringify(profile.emotionSeries ?? []),
    JSON.stringify(profile.reports ?? {}),
    JSON.stringify(profile.periodReports ?? {}),
    JSON.stringify(profile.behavior ?? null),
    JSON.stringify(profile.lastReport ?? null),
    profile.openerIdx || 0,
    JSON.stringify(profile.lastOpeners ?? []),
    JSON.stringify(profile.adaptLog ?? []),
    profile.generating ? 1 : 0,
    ts
  )

  const days = readJson('days.json') || []
  const insDay = db.prepare('INSERT INTO days (user_id, date, free_text, q1, q2, q3) VALUES (?, ?, ?, ?, ?, ?)')
  for (const d of days) insDay.run(userId, d.date, d.freeText || '', d.q1 || '', d.q2 || '', d.q3 || '')

  const chats = readJson('chats.json') || []
  const insChat = db.prepare(
    'INSERT INTO chats (user_id, session_id, source, day, messages, covered, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const c of chats) {
    insChat.run(userId, c.id, c.source, c.day, JSON.stringify(c.messages ?? []), c.covered ? 1 : 0, c.createdAt || ts, c.updatedAt || ts)
  }

  db.exec('COMMIT')
  console.log(`✅ 迁移完成: anning(userId=${userId}) / 日记 ${days.length} 条 / 会话 ${chats.length} 个`)
  console.log('   anning 新密码已设置为迁移参数值(请记录到文档)')
} catch (e) {
  db.exec('ROLLBACK')
  console.error('迁移失败:', e)
  process.exit(1)
}

// 旧 JSON 归档(不删除,保留观察)
const legacyDir = path.join(DATA_DIR, 'legacy-json')
fs.mkdirSync(legacyDir, { recursive: true })
for (const f of ['profile.json', 'days.json', 'chats.json']) {
  const src = path.join(DATA_DIR, f)
  if (fs.existsSync(src)) fs.renameSync(src, path.join(legacyDir, f))
}
console.log('旧 JSON 已移入 data/legacy-json/')
closeDB()
