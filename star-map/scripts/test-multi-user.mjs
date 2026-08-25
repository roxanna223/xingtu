// 多用户全链路测试(本地)
// 用法: node .test-tmp/test-all.mjs
const BASE = 'http://localhost:3001'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

async function api(method, path, { body, token } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Cookie'] = `star_session=${token}`
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {}
  const setCookie = res.headers.get('set-cookie') || ''
  const tokenOut = setCookie.match(/star_session=([^;]+)/)?.[1] || null
  return { status: res.status, data, token: tokenOut }
}

async function login(username, password) {
  const r = await api('POST', '/api/auth', { body: { action: 'login', username, password } })
  if (r.status === 200) return r.token
  return null
}

const results = {}
console.log('=== 多用户改造本地全链路测试 ===\n')

// ---- A. 基础登录与迁移数据 ----
console.log('A. 登录与迁移数据')
results.anning = await login('anning', 'AnningTest123!')
check('anning 登录成功', !!results.anning)
const sAnning = await api('GET', '/api/status', { token: results.anning })
check('anning 数据完好(dayCount=7)', sAnning.status === 200 && sAnning.data.dayCount === 7, JSON.stringify(sAnning.data))
check('anning 角色为 user', sAnning.data.user?.role === 'user')

results.admin = await login('admin', 'AdminTest123!')
check('admin 登录成功', !!results.admin)
const sAdmin = await api('GET', '/api/status', { token: results.admin })
check('admin 角色为 admin', sAdmin.data.user?.role === 'admin')

// ---- B. 邀请制注册 ----
console.log('B. 邀请制注册')
const noCode = await api('POST', '/api/auth', { body: { action: 'register', username: 'alice', password: 'alice12345' } })
check('无邀请码注册被拒(400)', noCode.status === 400, JSON.stringify(noCode.data))

const inv = await api('POST', '/api/admin/invites', { body: { count: 2, note: 'test' }, token: results.admin })
check('管理员生成 2 个邀请码(200)', inv.status === 200 && inv.data.codes?.length === 2, JSON.stringify(inv.data))
const [codeA, codeB] = inv.data.codes || []

const regA = await api('POST', '/api/auth', { body: { action: 'register', username: 'alice', password: 'alice12345', inviteCode: codeA, birthDate: '1998-03-21' } })
check('alice 用邀请码注册成功(200 + cookie)', regA.status === 200 && !!regA.token, JSON.stringify(regA.data))
check('alice 星座=白羊', regA.data?.user?.starSign === '白羊', JSON.stringify(regA.data))

const regDup = await api('POST', '/api/auth', { body: { action: 'register', username: 'bob', password: 'bob1234567', inviteCode: codeA } })
check('邀请码复用被拒(400)', regDup.status === 400, JSON.stringify(regDup.data))

const regB = await api('POST', '/api/auth', { body: { action: 'register', username: 'bob', password: 'bob1234567', inviteCode: codeB } })
check('bob 用第二个码注册成功', regB.status === 200 && !!regB.token)

const regSameName = await api('POST', '/api/auth', { body: { action: 'register', username: 'alice', password: 'alice12345', inviteCode: 'AAAAAAAA' } })
check('重名注册 409', regSameName.status === 409, JSON.stringify(regSameName.data))

const invList = await api('GET', '/api/admin/invites', { token: results.admin })
check('邀请码列表:2 个已使用', invList.data.invites.filter((i) => i.state === 'used').length === 2)

// ---- C. 数据隔离(不串号) ----
console.log('C. 数据隔离')
const sAlice = await api('GET', '/api/status', { token: regA.token })
check('alice dayCount=0(看不到 anning 的 7 天)', sAlice.data.dayCount === 0, JSON.stringify(sAlice.data))
const tAlice = await api('GET', '/api/tests', { token: regA.token })
check('alice 测验为空', tAlice.status === 200 && tAlice.data.tests.length === 0)

// alice 写一条记录
const recAlice = await api('POST', '/api/record', {
  token: regA.token,
  body: { date: '2026-08-25', freeText: '今天面试准备有点紧张，但整理完思路好多了', q1: '心情', q2: '', q3: '' },
})
check('alice 保存记录成功', recAlice.status === 200, JSON.stringify(recAlice.data))
const sAlice2 = await api('GET', '/api/status', { token: regA.token })
check('alice dayCount=1', sAlice2.data.dayCount === 1)
const sAnning2 = await api('GET', '/api/status', { token: results.anning })
check('anning 仍为 7 天(未被 alice 污染)', sAnning2.data.dayCount === 7)

// onboard:cohort/careerStage 写入 users 表(回归断言)
const ob = await api('POST', '/api/onboard', {
  token: regA.token,
  body: { birthYearMonth: '1998-03', careerStage: '应届求职', worries: ['面试焦虑', '方向迷茫'] },
})
check('alice onboard 成功', ob.status === 200, JSON.stringify(ob.data))
const sAliceOb = await api('GET', '/api/status', { token: regA.token })
check('onboarded=true(cohort 已落库)', sAliceOb.data.onboarded === true, JSON.stringify(sAliceOb.data))

// 越权:alice 用管理员 API
const adminApiByAlice = await api('GET', '/api/admin/users', { token: regA.token })
check('alice 访问管理员 API 被拒(403)', adminApiByAlice.status === 403, String(adminApiByAlice.status))
const adminApiAnon = await api('GET', '/api/admin/users')
check('未登录访问管理员 API 被拒(401)', adminApiAnon.status === 401)

// 越权:alice 操作不存在的 topicId(anning 的星星 id 空间)
const anningStarMap = await api('GET', '/api/star-map', { token: results.anning })
const anningNodeId = anningStarMap.data.nodes?.[0]?.id
if (anningNodeId) {
  const cross = await api('POST', '/api/topics', { token: regA.token, body: { action: 'rename', topicId: anningNodeId, newName: 'hack' } })
  check('alice 操作 anning 的星星被拒(404)', cross.status === 404, String(cross.status))
} else {
  check('anning 有星星可测', false)
}

// 篡改 token:把 alice token 用户名改成 anning
const forged = results.anning + '.' + regA.token.split('.').pop()
const forgedRes = await api('GET', '/api/status', { token: forged })
check('篡改签名 token 被拒(401)', forgedRes.status === 401)

// ---- D. 埋点 ----
console.log('D. 埋点')
const stats1 = await api('GET', '/api/admin/stats', { token: results.admin })
check('管理员看板可读(200)', stats1.status === 200)
const evRegister = stats1.data.daily.events.find((e) => e.event === 'register')
check('注册事件已记录(alice+bob 共 2)', evRegister?.n >= 2, JSON.stringify(stats1.data.daily.events))
const evLogin = stats1.data.daily.events.find((e) => e.event === 'login')
check('登录事件已记录', evLogin?.n >= 1)

// 管理员操作不产生埋点:记录当前 page_view 事件计数(管理员没有 page_view;测试用 admin 调 track)
await api('POST', '/api/track', { body: { event: 'page_view', path: '/admin' }, token: results.admin })
const stats2 = await api('GET', '/api/admin/stats', { token: results.admin })
const pvCount = (stats2.data.daily.events.find((e) => e.event === 'page_view')?.n) || 0
check('管理员 page_view 不计入埋点(pv=0)', pvCount === 0, `pv=${pvCount}`)

// alice 的 page_view 计入
await api('POST', '/api/track', { body: { event: 'page_view', path: '/record' }, token: regA.token })
const stats3 = await api('GET', '/api/admin/stats', { token: results.admin })
const pvCount2 = stats3.data.daily.events.find((e) => e.event === 'page_view')?.n || 0
check('用户 page_view 计入埋点(pv=1)', pvCount2 === 1, `pv=${pvCount2}`)

// ---- E. 注销 ----
console.log('E. 注销账号')
const delWrong = await api('POST', '/api/account', { token: regB.token, body: { action: 'delete', password: 'wrongpass123' } })
check('错误密码注销被拒(401)', delWrong.status === 401)
const delBob = await api('POST', '/api/account', { token: regB.token, body: { action: 'delete', password: 'bob1234567' } })
check('bob 正确密码注销成功(200)', delBob.status === 200)
const loginBob = await api('POST', '/api/auth', { body: { action: 'login', username: 'bob', password: 'bob1234567' } })
check('注销后 bob 无法登录(401)', loginBob.status === 401, JSON.stringify(loginBob.data))
const usersNow = await api('GET', '/api/admin/users', { token: results.admin })
check('用户列表无 bob(级联删除)', !usersNow.data.users.some((u) => u.username === 'bob'))
const sAlice3 = await api('GET', '/api/status', { token: regA.token })
check('bob 注销不影响 alice(dayCount=1)', sAlice3.data.dayCount === 1)

// ---- F. 注销事件匿名保留 ----
console.log('F. 注销事件保留(匿名)')
const stats4 = await api('GET', '/api/admin/stats', { token: results.admin })
const evDeleted = stats4.data.daily.events.find((e) => e.event === 'account_deleted')
check('注销事件已记录', !!evDeleted, JSON.stringify(stats4.data.daily.events))

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail > 0 ? 1 : 0)
