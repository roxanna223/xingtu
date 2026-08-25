// 管理员重置用户密码(多用户版)
// 用法: node scripts/reset-password.mjs <用户名> <新密码(至少8位)>
import { getDB, closeDB } from '../lib/db.js'
import crypto from 'node:crypto'

const username = String(process.argv[2] || '').trim()
const newPassword = process.argv[3]
if (!username || !newPassword || newPassword.length < 8) {
  console.error('用法: node scripts/reset-password.mjs <用户名> <新密码(至少8位)>')
  process.exit(1)
}

const db = getDB()
const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
if (!user) {
  console.error(`用户 "${username}" 不存在`)
  process.exit(1)
}
const salt = crypto.randomBytes(16)
const hash = crypto.scryptSync(newPassword, salt, 64)
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(`scrypt$${salt.toString('hex')}$${hash.toString('hex')}`, user.id)
console.log(`已为账号 "${username}" 重置密码`)
closeDB()
