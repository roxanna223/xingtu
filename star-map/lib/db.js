import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * SQLite 连接与建表(多用户改造方案 docs/15):
 *  - Node 内置 node:sqlite,零第三方依赖(本地 22.23 / 服务器 24 已验证)
 *  - WAL 模式 + 外键级联;schema 版本用 PRAGMA user_version 管理
 */

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'star.db')

let db = null

const SCHEMA = [
  // v1:多用户基础表
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',   -- user | admin
    birth_date    TEXT,
    star_sign     TEXT,
    star_symbol   TEXT,
    cohort        TEXT,                            -- JSON
    career_stage  TEXT NOT NULL DEFAULT '',
    persona_tier  TEXT NOT NULL DEFAULT 'logical',
    created_at    TEXT NOT NULL,
    last_active_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    topics         TEXT NOT NULL DEFAULT '[]',
    edges          TEXT NOT NULL DEFAULT '[]',
    feedback_log   TEXT NOT NULL DEFAULT '[]',
    emotion_series TEXT NOT NULL DEFAULT '[]',
    reports        TEXT NOT NULL DEFAULT '{}',
    period_reports TEXT NOT NULL DEFAULT '{}',
    behavior       TEXT,
    last_report    TEXT,
    opener_idx     INTEGER NOT NULL DEFAULT 0,
    last_openers   TEXT NOT NULL DEFAULT '[]',
    adapt_log      TEXT NOT NULL DEFAULT '[]',
    generating     INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS days (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date      TEXT NOT NULL,
    free_text TEXT NOT NULL DEFAULT '',
    q1 TEXT NOT NULL DEFAULT '',
    q2 TEXT NOT NULL DEFAULT '',
    q3 TEXT NOT NULL DEFAULT '',
    UNIQUE(user_id, date)
  )`,
  `CREATE TABLE IF NOT EXISTS chats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    source     TEXT NOT NULL,
    day        TEXT NOT NULL,
    messages   TEXT NOT NULL DEFAULT '[]',
    covered    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, session_id)
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL UNIQUE,
    note       TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at    TEXT,
    expires_at TEXT
  )`,
  // events:注销用户的事件保留(user_id 置 NULL 匿名化),管理员(role=admin)操作不写入
  `CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event   TEXT NOT NULL,
    path    TEXT NOT NULL DEFAULT '',
    detail  TEXT,
    ts      TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_days_user_date ON days(user_id, date)`,
  `CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)`,
  `CREATE INDEX IF NOT EXISTS idx_events_event ON events(event)`,
]

export function getDB() {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d) {
  const row = d.prepare('PRAGMA user_version').get()
  let v = row && row.user_version !== undefined ? row.user_version : 0
  if (v < 1) {
    d.exec('BEGIN')
    try {
      for (const sql of SCHEMA) d.exec(sql)
      d.exec('PRAGMA user_version = 1')
      d.exec('COMMIT')
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }
    v = 1
  }
  if (v < 2) {
    // v2:会话吊销黑名单(登出后无状态 token 立即失效)
    d.exec('BEGIN')
    try {
      d.exec(`CREATE TABLE IF NOT EXISTS revoked_tokens (
        token_sig  TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL
      )`)
      d.exec('PRAGMA user_version = 2')
      d.exec('COMMIT')
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }
  }
  if (v < 3) {
    // v3:危机标记持久化(修复 crisisFlag 只存内存、报告异步重读后丢失导致转介语不显示)
    d.exec('BEGIN')
    try {
      const cols = d.prepare('PRAGMA table_info(profiles)').all()
      if (!cols.some((c) => c.name === 'crisis_flag')) {
        d.exec('ALTER TABLE profiles ADD COLUMN crisis_flag INTEGER NOT NULL DEFAULT 0')
      }
      d.exec('PRAGMA user_version = 3')
      d.exec('COMMIT')
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }
  }
}

export function closeDB() {
  if (db) {
    db.close()
    db = null
  }
}

// 事务辅助(同步 API,手动 BEGIN/COMMIT)
export function transaction(fn) {
  const d = getDB()
  d.exec('BEGIN')
  try {
    const out = fn(d)
    d.exec('COMMIT')
    return out
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
