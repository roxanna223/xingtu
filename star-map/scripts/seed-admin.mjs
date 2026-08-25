// 创建/重置管理员账号(方案 docs/15 §管理员)
// 用法: node scripts/seed-admin.mjs <管理员用户名> <密码(至少8位)> [--reset]
//  - 已存在同名管理员则跳过;--reset 强制重置密码
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDB, closeDB } from '../lib/db.js'

const username = String(process.argv[2] || 'admin').trim()
const password = process.argv[3]
const reset = process.argv.includes('--reset')
if (!password || password.length < 8) {
  console.error('用法: node scripts/seed-admin.mjs <管理员用户名> <密码(至少8位)> [--reset]')
  process.exit(1)
}
if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/.test(username)) {
  console.error('管理员用户名需 2~20 位(中文/字母/数字/_/-)')
  process.exit(1)
}

const db = getDB()
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username)
if (existing && !reset) {
  console.log(`管理员 ${username} 已存在(id=${existing.id}),跳过。如需重置密码加 --reset`)
  closeDB()
  process.exit(0)
}

const ts = new Date().toISOString()
if (existing && reset) {
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(hashPassword(password), 'admin', existing.id)
  console.log(`✅ 管理员 ${username} 密码已重置`)
} else {
  const r = db
    .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword(password), 'admin', ts)
  const userId = Number(r.lastInsertRowid)
  db.prepare('INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)').run(userId, ts)
  console.log(`✅ 管理员 ${username} 已创建(userId=${userId})`)
}
closeDB()
