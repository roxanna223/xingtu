// 调试时钟：进程级的"日期偏移"（单位：天）。
// 调试面板可临时把整个服务端的"今天"前移/后移 N 天，
// 用于测试 6:00 划日、日报生成、每日问题、目标按天逻辑等日期相关行为。
// 进程重启后偏移归零（调试态，不持久化到用户数据）。
//
// 注意：状态挂在 globalThis 上——Next.js dev 模式会把每个 route 单独打包，
// 模块级变量在 bundle 之间不共享；globalThis 在同一 Node 进程内全局共享。

const GLOBAL_KEY = '__xingtu_clock_offset_ms'

export function setClockOffsetDays(days) {
  const n = Number(days)
  const clamped = Number.isFinite(n) ? Math.max(-366, Math.min(366, n)) : 0
  globalThis[GLOBAL_KEY] = clamped * 86400000
}

export function getClockOffsetDays() {
  const d = (globalThis[GLOBAL_KEY] || 0) / 86400000
  return Math.round(d * 4) / 4 // 显示保留 0.25 天精度
}

/** 调试偏移后的"现在"（服务端所有日期计算的统一时间源） */
export function fakeNow() {
  return new Date(Date.now() + (globalThis[GLOBAL_KEY] || 0))
}

/** 调试偏移后的 UTC 日期字符串 YYYY-MM-DD（与原 today() 口径一致） */
export function fakeTodayISO() {
  return fakeNow().toISOString().slice(0, 10)
}
