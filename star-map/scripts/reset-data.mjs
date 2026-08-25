// 重置指定用户数据(演示排练用;多用户版)
// 用法: node scripts/reset-data.mjs --user <用户名>
import { getDB, closeDB } from '../lib/db.js'
import { resolveUserId } from './lib-user.mjs'

const userId = resolveUserId()
const db = getDB()
db.exec('BEGIN')
try {
  db.prepare('DELETE FROM days WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM chats WHERE user_id = ?').run(userId)
  db.prepare(
    `UPDATE profiles SET topics='[]', edges='[]', feedback_log='[]', emotion_series='[]', reports='{}',
     period_reports='{}', behavior=NULL, last_report=NULL, opener_idx=0, last_openers='[]',
     adapt_log='[]', generating=0, updated_at=? WHERE user_id = ?`
  ).run(new Date().toISOString(), userId)
  db.prepare('DELETE FROM events WHERE user_id = ?').run(userId)
  db.exec('COMMIT')
  console.log('该用户数据已重置(账号保留,画像/日记/对话/埋点清空)')
} catch (e) {
  db.exec('ROLLBACK')
  console.error('重置失败:', e)
  process.exit(1)
}
closeDB()
