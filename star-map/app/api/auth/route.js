import { readProfile, writeProfile, readDays, writeDays, writeChats, defaultProfile } from '@/lib/store'
import { cohortFor, starSignFor } from '@/lib/cohort'

// 本地模拟注册/登录（无数据库，写 profile.json）
// 注册必填用户名/密码；出生日期选填——填写后对应星座，作为星图起点
export async function POST(req) {
  const body = await req.json()
  const { action = 'register', username = '', password = '', birthDate = '' } = body || {}
  const name = String(username).trim()
  if (!name || !String(password).trim()) {
    return Response.json({ error: '用户名与密码必填' }, { status: 400 })
  }

  const p = readProfile()
  p.user = p.user || {}

  if (action === 'register') {
    if (p.user.username && p.user.username !== name) {
      // 本地模拟环境：换账号即全量重置画像与日记。
      // 用 defaultProfile 重建并清空全部旧键，避免 tests/generating/crisisFlag 等后加字段残留到新账号
      Object.keys(p).forEach((k) => delete p[k])
      Object.assign(p, defaultProfile())
      writeDays([])
      writeChats([]) // P0-1：换账号同步清空对话存档，避免旧账号对话残留
    }
    p.user.username = name
    p.user.passwordHash = 'local-' + Buffer.from(String(password)).toString('base64').slice(0, 12)
    if (birthDate) {
      const sign = starSignFor(birthDate)
      p.user.birthDate = String(birthDate).slice(0, 10)
      p.user.starSign = sign ? sign.name : null
      p.user.starSymbol = sign ? sign.symbol : null
      if (!p.user.cohort) p.user.cohort = cohortFor(String(birthDate).slice(0, 7))
    }
  } else {
    // 登录（模拟）：账号匹配即通过
    if (p.user.username !== name) {
      return Response.json({ error: '账号不存在，请先注册' }, { status: 401 })
    }
  }

  writeProfile(p)
  return Response.json({
    ok: true,
    user: { username: p.user.username, starSign: p.user.starSign || null, starSymbol: p.user.starSymbol || null },
  })
}
