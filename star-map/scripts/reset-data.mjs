// 重置画像数据（演示排练用）
// 用法：npm run reset
import fs from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), 'data')
for (const f of ['profile.json', 'days.json', 'chats.json']) {
  fs.rmSync(path.join(dir, f), { force: true })
}
console.log('画像数据已重置。下一步：npm run import ../data/演示数据-7天日记.md')
