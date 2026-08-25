// 维护脚本公共:解析 --user <用户名> → userId
// 用法: node scripts/xxx.mjs --user anning [...]
import { getDB } from '../lib/db.js'

export function resolveUserId() {
  const i = process.argv.indexOf('--user')
  if (i < 0 || !process.argv[i + 1]) {
    console.error('缺少 --user <用户名> 参数(多用户模式下所有数据操作必须指定用户)')
    process.exit(1)
  }
  const username = String(process.argv[i + 1]).trim()
  const user = getDB().prepare('SELECT id, username FROM users WHERE username = ?').get(username)
  if (!user) {
    console.error(`用户 "${username}" 不存在`)
    process.exit(1)
  }
  return user.id
}
