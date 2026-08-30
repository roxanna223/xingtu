// Next.js instrumentation：服务启动时注册 6:00 夜间作业调度器（docs/23 §4.4）。
// 每 60 秒检查一次：命中 06:00~06:15 窗口且当天未尝试过 → 为所有用户预生成昨日日报 + 进化收尾。
// 幂等由 jobs 表兜底（进程重启/并发都安全）；不阻塞请求。

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { inMorningWindow, runOvernightAll, yesterdayKey } = await import('./lib/overnight.js')

  let triedDay = ''
  const tick = () => {
    try {
      if (!inMorningWindow()) return
      const day = yesterdayKey()
      if (day === triedDay) return
      triedDay = day
      runOvernightAll({ targetDay: day }).catch((e) => console.warn('[overnight] 定时作业失败：', e.message))
    } catch {
      /* 调度器自身异常不影响服务 */
    }
  }

  setInterval(tick, 60 * 1000)
  tick()
}
