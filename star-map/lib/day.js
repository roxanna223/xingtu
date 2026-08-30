// 6:00 划日（docs/23 统一方案 §3.2）：
// 一个"自然日"从当天 06:00 到次日 05:59。日报在次日 6:00 刷新，总结过去一整天（含凌晨）。
// 例如 8/30 01:00 的内容属于 8/29 这一天。
// 时间源统一走 lib/clock（调试面板可偏移"今天"）。

import { fakeNow } from './clock.js'

const pad = (n) => String(n).padStart(2, '0')
const DAY_MS = 86400000

/** 'YYYY-MM-DD'（本地时区） */
export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本地时区下某时刻所属的 6:00 划日 key：当天 06:00 前归前一天 */
export function dayKeyOf(date) {
  const d = date ? new Date(date.getTime()) : fakeNow()
  if (d.getHours() < 6) d.setDate(d.getDate() - 1)
  return fmtDate(d)
}

/** 当前（本地时区）的 6:00 划日 key */
export function todayKey() {
  return dayKeyOf()
}

/** 解析 'YYYY-MM-DD'（本地时区 00:00） */
export function parseKey(key) {
  const [y, m, d] = String(key).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 某 6:00 划日的起止时刻：key 日 06:00 ~ key+1 日 05:59:59.999 */
export function dayRange(key) {
  const start = parseKey(key)
  start.setHours(6, 0, 0, 0)
  const end = new Date(start.getTime() + DAY_MS - 1)
  return { start, end }
}

/** ISO 时间戳 → 6:00 划日 key（本地时区） */
export function dayKeyOfIso(iso) {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return todayKey()
  return dayKeyOf(t)
}

/** 事件流的"现在" ISO 字符串 */
export function nowIso() {
  return fakeNow().toISOString()
}

/** 按 6:00 划日格式化显示（给用户看的日期） */
export function fmtKey(key) {
  const d = parseKey(key)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
