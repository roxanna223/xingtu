import { getDB, transaction } from './db.js'
import crypto from 'node:crypto'

/**
 * 多用户数据层(方案 docs/15):
 *  - 所有函数以 userId 为第一参数,行级隔离(user_id 强制 WHERE)
 *  - days/chats 保持"整读整写"数组语义(引擎零改动),写操作在锁内 DELETE+INSERT(事务)
 *  - profiles 为每用户一行,大 JSON 整存
 */

const now = () => new Date().toISOString()
const jstr = (v) => JSON.stringify(v ?? null)
const jparse = (s, fallback) => {
  try {
    return s == null ? fallback : JSON.parse(s)
  } catch {
    return fallback
  }
}

/* ---------------- 进程内读-改-写互斥(与 JSON 版同策略) ---------------- */

let storeQueue = Promise.resolve()

export function withStoreLock(task) {
  const run = storeQueue.then(task, task)
  storeQueue = run.then(
    () => {},
    () => {}
  )
  return run
}

/* ---------------- users ---------------- */

export function findUserByUsername(username) {
  const row = getDB().prepare('SELECT * FROM users WHERE username = ?').get(String(username))
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    birthDate: row.birth_date,
    starSign: row.star_sign,
    starSymbol: row.star_symbol,
    cohort: jparse(row.cohort, null),
    careerStage: row.career_stage,
    personaTier: row.persona_tier,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  }
}

export function findUserById(id) {
  const row = getDB().prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!row) return null
  return findUserByUsername(row.username)
}

export function createUser({ username, passwordHash, role = 'user', birthDate = null, starSign = null, starSymbol = null, cohort = null, careerStage = '', personaTier = 'logical' }) {
  const d = getDB()
  return transaction(() => {
    const ts = now()
    const r = d
      .prepare(
        `INSERT INTO users (username, password_hash, role, birth_date, star_sign, star_symbol, cohort, career_stage, persona_tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(String(username), passwordHash, role, birthDate, starSign, starSymbol, jstr(cohort), careerStage, personaTier, ts)
    const userId = Number(r.lastInsertRowid)
    d.prepare(
      `INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)`
    ).run(userId, ts)
    return userId
  })
}

export function updateUserPassword(userId, passwordHash) {
  getDB().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId)
}

export function touchUserActive(userId) {
  getDB().prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(now(), userId)
}

export function deleteUserById(userId) {
  // 外键 ON DELETE CASCADE 自动清 profiles/days/chats;invites 的 created_by/used_by 置 NULL;events 的 user_id 置 NULL(匿名化保留)
  getDB().prepare('DELETE FROM users WHERE id = ?').run(userId)
}

export function listUsers() {
  const rows = getDB()
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at, u.last_active_at,
              (SELECT COUNT(*) FROM days d WHERE d.user_id = u.id) AS day_count,
              (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id) AS chat_count
       FROM users u ORDER BY u.id`
    )
    .all()
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    role: r.role,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
    dayCount: r.day_count,
    chatCount: r.chat_count,
  }))
}

export function countUsers() {
  return getDB().prepare('SELECT COUNT(*) AS n FROM users').get().n
}

/* ---------------- profiles(画像) ---------------- */

const PROFILE_KEYS = ['topics', 'edges', 'feedback_log', 'emotion_series', 'reports', 'period_reports', 'behavior', 'last_report', 'opener_idx', 'last_openers', 'adapt_log', 'generating']

export function readProfile(userId) {
  const d = getDB()
  const row = d.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId)
  const user = findUserById(userId)
  const base = {
    user: {
      username: user?.username || '',
      cohort: user?.cohort || null,
      careerStage: user?.careerStage || '',
      personaTier: user?.personaTier || 'logical',
      starSign: user?.starSign || null,
      starSymbol: user?.starSymbol || null,
      birthDate: user?.birthDate || null,
    },
    topics: [],
    edges: [],
    feedbackLog: [],
    emotionSeries: [],
    lastReport: null,
    reports: {},
    periodReports: {},
    behavior: null,
    openerIdx: 0,
    lastOpeners: [],
    adaptLog: [],
    generating: false,
  }
  if (!row) return base
  const p = base
  p.topics = jparse(row.topics, [])
  p.edges = jparse(row.edges, [])
  p.feedbackLog = jparse(row.feedback_log, [])
  p.emotionSeries = jparse(row.emotion_series, [])
  p.reports = jparse(row.reports, {})
  p.periodReports = jparse(row.period_reports, {})
  p.behavior = jparse(row.behavior, null)
  p.lastReport = jparse(row.last_report, null)
  p.openerIdx = row.opener_idx || 0
  p.lastOpeners = jparse(row.last_openers, [])
  p.adaptLog = jparse(row.adapt_log, [])
  p.generating = !!row.generating
  p.crisisFlag = !!row.crisis_flag
  return p
}

export function writeProfile(userId, p) {
  const d = getDB()
  d.prepare(
    `INSERT INTO profiles (user_id, topics, edges, feedback_log, emotion_series, reports, period_reports, behavior, last_report, opener_idx, last_openers, adapt_log, generating, crisis_flag, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       topics=excluded.topics, edges=excluded.edges, feedback_log=excluded.feedback_log,
       emotion_series=excluded.emotion_series, reports=excluded.reports, period_reports=excluded.period_reports,
       behavior=excluded.behavior, last_report=excluded.last_report, opener_idx=excluded.opener_idx,
       last_openers=excluded.last_openers, adapt_log=excluded.adapt_log, generating=excluded.generating,
       crisis_flag=excluded.crisis_flag, updated_at=excluded.updated_at`
  ).run(
    userId,
    jstr(p.topics ?? []),
    jstr(p.edges ?? []),
    jstr(p.feedbackLog ?? []),
    jstr(p.emotionSeries ?? []),
    jstr(p.reports ?? {}),
    jstr(p.periodReports ?? {}),
    jstr(p.behavior ?? null),
    jstr(p.lastReport ?? null),
    p.openerIdx || 0,
    jstr(p.lastOpeners ?? []),
    jstr(p.adaptLog ?? []),
    p.generating ? 1 : 0,
    p.crisisFlag ? 1 : 0,
    now()
  )
  // 用户维度字段(engine/onboard 会改 p.user.*)同步落 users 表,避免丢失
  if (p.user) {
    d.prepare('UPDATE users SET persona_tier = ?, career_stage = ?, cohort = ? WHERE id = ?').run(
      p.user.personaTier || 'logical',
      p.user.careerStage || '',
      jstr(p.user.cohort ?? null),
      userId
    )
  }
}

/* ---------------- days(日记) ---------------- */

export function readDays(userId) {
  return getDB()
    .prepare('SELECT date, free_text, q1, q2, q3 FROM days WHERE user_id = ? ORDER BY date')
    .all(userId)
    .map((r) => ({ date: r.date, freeText: r.free_text, q1: r.q1, q2: r.q2, q3: r.q3 }))
}

export function writeDays(userId, arr) {
  const d = getDB()
  transaction(() => {
    d.prepare('DELETE FROM days WHERE user_id = ?').run(userId)
    const ins = d.prepare('INSERT INTO days (user_id, date, free_text, q1, q2, q3) VALUES (?, ?, ?, ?, ?, ?)')
    for (const day of arr || []) {
      ins.run(userId, day.date, day.freeText || '', day.q1 || '', day.q2 || '', day.q3 || '')
    }
  })
}

/* ---------------- chats(对话会话) ---------------- */

export function readChats(userId) {
  return getDB()
    .prepare('SELECT session_id, source, day, messages, covered, created_at, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId)
    .map((r) => ({
      id: r.session_id,
      source: r.source,
      day: r.day,
      messages: jparse(r.messages, []),
      covered: !!r.covered,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
}

export function writeChats(userId, arr) {
  const d = getDB()
  transaction(() => {
    d.prepare('DELETE FROM chats WHERE user_id = ?').run(userId)
    const ins = d.prepare(
      'INSERT INTO chats (user_id, session_id, source, day, messages, covered, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const c of arr || []) {
      ins.run(userId, c.id, c.source, c.day, jstr(c.messages ?? []), c.covered ? 1 : 0, c.createdAt || now(), c.updatedAt || now())
    }
  })
}

/* ---------------- invites(邀请码) ---------------- */

export function createInvites(adminId, count, note = '', ttlDays = null) {
  const d = getDB()
  const codes = []
  transaction(() => {
    const ins = d.prepare('INSERT INTO invites (code, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    for (let i = 0; i < count; i++) {
      const code = genInviteCode()
      const exp = ttlDays ? new Date(Date.now() + ttlDays * 86400000).toISOString() : null
      ins.run(code, String(note || '').slice(0, 100), adminId, now(), exp)
      codes.push(code)
    }
  })
  return codes
}

// 8 位邀请码,排除易混字符(0/O、1/I/L),用加密随机数生成
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function genInviteCode() {
  let s = ''
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  return s
}

export function listInvites() {
  return getDB()
    .prepare(
      `SELECT i.code, i.note, i.created_at, i.used_at, i.expires_at, u.username AS used_by_name
       FROM invites i LEFT JOIN users u ON u.id = i.used_by
       ORDER BY i.id DESC LIMIT 200`
    )
    .all()
    .map((r) => ({
      code: r.code,
      note: r.note,
      createdAt: r.created_at,
      usedAt: r.used_at,
      expiresAt: r.expires_at,
      usedBy: r.used_by_name || null,
      state: r.used_at ? 'used' : r.expires_at && r.expires_at < now() ? 'expired' : 'active',
    }))
}

export function inviteStats() {
  const d = getDB()
  const total = d.prepare('SELECT COUNT(*) AS n FROM invites').get().n
  const used = d.prepare('SELECT COUNT(*) AS n FROM invites WHERE used_at IS NOT NULL').get().n
  return { total, used, active: total - used }
}

/** 校验邀请码是否可用(不消耗)。true=可用 */
export function isInviteAvailable(code) {
  const row = getDB().prepare('SELECT id, used_at, expires_at FROM invites WHERE code = ?').get(String(code).trim().toUpperCase())
  if (!row || row.used_at) return false
  if (row.expires_at && row.expires_at < now()) return false
  return true
}

/** 校验并消耗邀请码(事务,一次性)。返回 true=成功 */
export function consumeInvite(code, userId) {
  const d = getDB()
  return transaction(() => {
    const row = d.prepare('SELECT id, used_at, expires_at FROM invites WHERE code = ?').get(String(code).trim().toUpperCase())
    if (!row) return false
    if (row.used_at) return false
    if (row.expires_at && row.expires_at < now()) return false
    d.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?').run(userId, now(), row.id)
    return true
  })
}

/* ---------------- 会话吊销(登出黑名单) ---------------- */

/** 吊销会话 token(按签名段存储,过期后自动清理) */
export function revokeToken(tokenSig, expiresAtMs) {
  const d = getDB()
  d.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(now())
  d.prepare('INSERT OR REPLACE INTO revoked_tokens (token_sig, expires_at) VALUES (?, ?)').run(
    String(tokenSig).slice(0, 128),
    new Date(expiresAtMs).toISOString()
  )
}

export function isTokenRevoked(tokenSig) {
  return !!getDB().prepare('SELECT token_sig FROM revoked_tokens WHERE token_sig = ?').get(String(tokenSig).slice(0, 128))
}

/* ---------------- events(埋点) ---------------- */

export function trackEvent(userId, event, path = '', detail = null) {
  getDB()
    .prepare('INSERT INTO events (user_id, event, path, detail, ts) VALUES (?, ?, ?, ?, ?)')
    .run(userId, String(event).slice(0, 40), String(path || '').slice(0, 200), detail ? jstr(detail) : null, now())
}

export function statsOverview() {
  const d = getDB()
  const totalUsers = d.prepare('SELECT COUNT(*) AS n FROM users').get().n
  const users7d = d.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now','-6 days')").get().n
  const activeToday = d.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE ts >= date('now') AND user_id IS NOT NULL").get().n
  const pvToday = d.prepare("SELECT COUNT(*) AS n FROM events WHERE ts >= date('now')").get().n
  const inv = inviteStats()
  return { totalUsers, users7d, activeToday, pvToday, invites: inv }
}

export function statsDaily(days = 7) {
  const d = getDB()
  const pv = d
    .prepare("SELECT date(ts) AS day, COUNT(*) AS n FROM events WHERE ts >= datetime('now', ?) GROUP BY day ORDER BY day")
    .all(`-${days - 1} days`)
  const active = d
    .prepare(
      "SELECT date(ts) AS day, COUNT(DISTINCT user_id) AS n FROM events WHERE ts >= datetime('now', ?) AND user_id IS NOT NULL GROUP BY day ORDER BY day"
    )
    .all(`-${days - 1} days`)
  const events = d
    .prepare("SELECT event, COUNT(*) AS n FROM events WHERE ts >= datetime('now', ?) GROUP BY event ORDER BY n DESC")
    .all(`-${days - 1} days`)
  return { pv: pv.map((r) => ({ day: r.day, n: r.n })), active: active.map((r) => ({ day: r.day, n: r.n })), events: events.map((r) => ({ event: r.event, n: r.n })) }
}
