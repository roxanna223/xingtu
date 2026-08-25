import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { findUserByUsername, isTokenRevoked, revokeToken } from './store'

/**
 * 公网安全基座(清单 A1/A2/A5):
 *  - 密码哈希:Node 内置 scrypt + 随机盐,零第三方依赖,替代原 base64 可逆编码
 *  - 会话:HMAC-SHA256 签名 token + httpOnly cookie,密钥取自 SESSION_SECRET 或 data/.session-secret
 *  - 登录限流:同 IP 连续 5 次失败锁 15 分钟(进程内,单实例部署足够)
 *  - CSRF:写请求校验 Origin 与 Host 一致
 */

export const SESSION_COOKIE = 'star_session'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 天

/* ---------------- 密码哈希(scrypt) ---------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false
  const parts = stored.split('$')
  if (parts.length !== 3) return false
  try {
    const salt = Buffer.from(parts[1], 'hex')
    const expected = Buffer.from(parts[2], 'hex')
    const actual = crypto.scryptSync(String(password), salt, 64)
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** 旧版本 base64 可逆"哈希"(local- 前缀)视为失效,必须重置 */
export function isLegacyHash(stored) {
  return typeof stored === 'string' && stored.length > 0 && !stored.startsWith('scrypt$')
}

/* ---------------- 会话(HMAC 签名 token) ---------------- */

const SECRET_FILE = path.join(process.cwd(), 'data', '.session-secret')
let cachedSecret = null

function getSecret() {
  if (cachedSecret) return cachedSecret
  if (process.env.SESSION_SECRET) {
    cachedSecret = process.env.SESSION_SECRET
    return cachedSecret
  }
  // 未配置时:持久化随机密钥到 data/.session-secret(.gitignore 已排除 data/*.json 与 .env,
  // 但 .session-secret 不在规则内,确保 data/ 整体不提交;服务器重启后会话仍有效)
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true })
    if (fs.existsSync(SECRET_FILE)) {
      cachedSecret = fs.readFileSync(SECRET_FILE, 'utf8').trim()
      if (cachedSecret) return cachedSecret
    }
  } catch {}
  cachedSecret = crypto.randomBytes(32).toString('hex')
  try {
    fs.writeFileSync(SECRET_FILE, cachedSecret, { encoding: 'utf8', mode: 0o600 })
  } catch {}
  return cachedSecret
}

export function createSessionToken(username) {
  const exp = Date.now() + SESSION_TTL_SECONDS * 1000
  const payload = `${username}.${exp}`
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySessionToken(token) {
  if (typeof token !== 'string' || !token) return null
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null
  const payload = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  // 登出吊销黑名单(2026-08-25:登出后 token 必须立即失效)
  if (isTokenRevoked(sig)) return null
  const expect = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const sep = payload.indexOf('.')
  if (sep <= 0) return null
  const exp = Number(payload.slice(sep + 1))
  if (!Number.isFinite(exp) || Date.now() > exp) return null
  return payload.slice(0, sep)
}

/** 登出/注销时吊销会话:token 写入黑名单直至其自然过期 */
export function revokeSessionToken(token) {
  if (typeof token !== 'string' || !token) return
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return
  const expStr = token.slice(token.indexOf('.') + 1, idx)
  const exp = Number(expStr)
  if (!Number.isFinite(exp)) return
  revokeToken(token.slice(idx + 1), exp)
}

/** 请求是否为 HTTPS(Nginx 反代时带 X-Forwarded-Proto;直连 HTTP 为 false) */
export function reqIsHttps(req) {
  try {
    return req?.headers?.get?.('x-forwarded-proto') === 'https'
  } catch {
    return false
  }
}

/**
 * 会话 cookie 序列化。
 * Secure 仅在 HTTPS 请求时附加:HTTP 直连(IP:端口演示阶段)加 Secure 会导致浏览器拒绝存储,
 * 登录后被 AuthGate 弹回注册页(2026-08-25 线上 bug)。
 */
export function serializeSessionCookie(token, secure = false) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie(secure = false) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/* ---------------- 请求级辅助(鉴权 / CSRF / IP / JSON) ---------------- */

/** 从请求提取原始会话 token(无则 null) */
export function getSessionToken(req) {
  try {
    const header = req.headers.get('cookie') || ''
    const m = header.match(/(?:^|;\s*)star_session=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

export function getSessionUser(req) {
  const token = getSessionToken(req)
  return token ? verifySessionToken(token) : null
}

/** API 鉴权入口:未登录返回 401 响应;通过则返回 { user: {id,username,role,...} } */
export function requireAuth(req) {
  const username = getSessionUser(req)
  if (!username) {
    return { user: null, response: Response.json({ error: '未登录或会话已过期' }, { status: 401 }) }
  }
  const u = findUserByUsername(username)
  if (!u) {
    return { user: null, response: Response.json({ error: '账号不存在' }, { status: 401 }) }
  }
  return { user: u, response: null }
}

/** 管理员鉴权入口:非管理员返回 401/403 */
export function requireAdmin(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth
  if (auth.user.role !== 'admin') {
    return { user: null, response: Response.json({ error: '无管理员权限' }, { status: 403 }) }
  }
  return auth
}

/** 取客户端 IP(Nginx 反代时以 X-Forwarded-For 首项为准) */
export function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return String(xff).split(',')[0].trim().slice(0, 64) || 'unknown'
  return 'unknown'
}

/** CSRF 防线:浏览器跨站请求必带 Origin,Origin 与 Host 不一致即拒绝;无 Origin(同源工具/CLI)放行 */
export function assertSameOrigin(req) {
  const origin = req.headers.get('origin')
  if (!origin) return true
  const host = req.headers.get('host')
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** 安全解析 JSON 请求体:限制大小、必须是对象;失败返回 { __error } */
export async function readJsonBody(req) {
  try {
    const text = await req.text()
    if (!text) return {}
    if (text.length > 200_000) return { __error: '请求体过大' }
    const obj = JSON.parse(text)
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return { __error: '请求体必须是 JSON 对象' }
    }
    return obj
  } catch {
    return { __error: '无效的 JSON 请求体' }
  }
}

/* ---------------- 登录限流(进程内,IP + 用户名双维度) ---------------- */

const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000
const attempts = new Map()

function lockKey(ip, username) {
  return username ? `u:${username}` : `ip:${ip}`
}

export function loginLockState(ip, username = '') {
  const rec = attempts.get(lockKey(ip, username))
  if (rec && rec.lockUntil > Date.now()) {
    return { retryAfterSec: Math.ceil((rec.lockUntil - Date.now()) / 1000) }
  }
  return null
}

export function recordLoginFailure(ip, username = '') {
  // 双维度记录:IP 维度 + 用户名维度,任一维度满 5 次即锁
  for (const key of [`ip:${ip}`, username ? `u:${username}` : null].filter(Boolean)) {
    const rec = attempts.get(key) || { count: 0, lockUntil: 0 }
    rec.count += 1
    if (rec.count >= MAX_FAILS) {
      rec.lockUntil = Date.now() + LOCK_MS
      rec.count = 0
    }
    attempts.set(key, rec)
  }
  if (attempts.size > 1000) {
    const cutoff = Date.now() - LOCK_MS
    for (const [k, v] of attempts) if (v.lockUntil < cutoff) attempts.delete(k)
  }
}

export function clearLoginFailures(ip, username = '') {
  attempts.delete(`ip:${ip}`)
  if (username) attempts.delete(`u:${username}`)
}
