import { findUserByUsername, createUser, isInviteAvailable, consumeInvite, deleteUserById, trackEvent } from '@/lib/store'
import { starSignFor, cohortFor } from '@/lib/cohort'
import {
  hashPassword,
  verifyPassword,
  isLegacyHash,
  createSessionToken,
  serializeSessionCookie,
  reqIsHttps,
  clientIp,
  loginLockState,
  recordLoginFailure,
  clearLoginFailures,
  assertSameOrigin,
  readJsonBody,
} from '@/lib/auth'

// 注册(2026-08-25 起邀请码选填):不填可直接注册;填写则必须有效且一次性消耗
const NAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,20}$/

export async function POST(req) {
  // CSRF:跨站请求拒绝
  if (!assertSameOrigin(req)) {
    return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  }

  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { action = 'register', username = '', password = '', birthDate = '', inviteCode = '' } = body

  const name = String(username).trim()
  const ip = clientIp(req)

  // 双维度限流(IP + 用户名):任一维度锁定则拒绝
  const lock = loginLockState(ip, '') || (name ? loginLockState('', name) : null)
  if (lock) {
    return Response.json({ error: `尝试次数过多，请 ${lock.retryAfterSec} 秒后再试` }, { status: 429, headers: { 'Retry-After': String(lock.retryAfterSec) } })
  }

  if (!NAME_RE.test(name)) {
    return Response.json({ error: '昵称需 2~20 位，仅限中文/字母/数字/下划线/连字符' }, { status: 400 })
  }
  const pw = String(password)
  if (!pw) return Response.json({ error: '密码必填' }, { status: 400 })

  if (action === 'register') {
    if (pw.length < 8) return Response.json({ error: '密码至少 8 位' }, { status: 400 })
    // 邀请码选填(2026-08-25 决策变更):不填可直接注册;填了则必须有效并一次性消耗
    const code = String(inviteCode || '').trim().toUpperCase()

    // 昵称冲突优先提示(优于邀请码错误,避免用户修正邀请码后才被告知重名)
    if (findUserByUsername(name)) {
      recordLoginFailure(ip, name)
      return Response.json({ error: '该昵称已被使用，换一个吧' }, { status: 409 })
    }
    if (code && !isInviteAvailable(code)) {
      recordLoginFailure(ip, name)
      return Response.json({ error: '邀请码无效、已使用或已过期' }, { status: 400 })
    }

    let sign = null
    if (birthDate) sign = starSignFor(birthDate)
    const cohort = birthDate ? cohortFor(String(birthDate).slice(0, 7)) : null

    try {
      const userId = createUser({
        username: name,
        passwordHash: hashPassword(pw),
        role: 'user',
        birthDate: birthDate ? String(birthDate).slice(0, 10) : null,
        starSign: sign ? sign.name : null,
        starSymbol: sign ? sign.symbol : null,
        cohort,
      })
      if (code) {
        const consumed = consumeInvite(code, userId)
        if (!consumed) {
          // 极端并发下邀请码被抢:回滚用户创建
          deleteUserById(userId)
          recordLoginFailure(ip, name)
          return Response.json({ error: '邀请码无效、已使用或已过期' }, { status: 400 })
        }
      }
      clearLoginFailures(ip, name)
      trackEvent(userId, 'register', '/api/auth', { inviteUsed: !!code })
      const token = createSessionToken(name)
      return new Response(
        JSON.stringify({ ok: true, user: { username: name, starSign: sign ? sign.name : null, starSymbol: sign ? sign.symbol : null } }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': serializeSessionCookie(token, reqIsHttps(req)) } }
      )
    } catch (e) {
      if (String(e?.message || '').includes('UNIQUE')) {
        recordLoginFailure(ip, name)
        return Response.json({ error: '该昵称已被使用，换一个吧' }, { status: 409 })
      }
      console.error('[auth] 注册失败:', e)
      return Response.json({ error: '注册失败，请稍后重试' }, { status: 500 })
    }
  }

  // ---------- 登录:账号 + 密码双校验 ----------
  const user = findUserByUsername(name)
  if (!user) {
    recordLoginFailure(ip, name)
    return Response.json({ error: '账号不存在，请先注册' }, { status: 401 })
  }
  if (isLegacyHash(user.passwordHash)) {
    recordLoginFailure(ip, name)
    return Response.json({ error: '该账号为旧版本数据，密码已失效，请联系管理员重置' }, { status: 401 })
  }
  if (!verifyPassword(pw, user.passwordHash)) {
    recordLoginFailure(ip, name)
    return Response.json({ error: '密码不正确' }, { status: 401 })
  }
  clearLoginFailures(ip, name)
  trackEvent(user.id, 'login', '/api/auth')

  const token = createSessionToken(name)
  return new Response(
    JSON.stringify({
      ok: true,
      user: { username: name, starSign: user.starSign || null, starSymbol: user.starSymbol || null },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': serializeSessionCookie(token, reqIsHttps(req)) } }
  )
}
