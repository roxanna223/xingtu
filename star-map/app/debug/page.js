'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'

// 调试面板（dev 环境自动开放；生产需 DEBUG_ENABLED=1 且为管理员）
// 覆盖：模拟日期 / 报告缓存 / 6:00 夜间作业 / 对话抽取 / 用户切换 / 重置画像 / 数据概况

export default function DebugPage() {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [offsetInput, setOffsetInput] = useState('0')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  async function load() {
    try {
      const r = await fetch('/api/debug')
      const d = await r.json()
      setInfo(d)
      if (d.clock) setOffsetInput(String(d.clock.offsetDays))
    } catch {
      setInfo({ available: false, reason: '无法连接调试 API' })
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function act(payload, okMsg) {
    setBusy(true)
    try {
      const r = await fetch('/api/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (r.ok) {
        showToast(okMsg || '已执行 ✓')
        if (payload.action === 'loginAs') {
          window.location.href = '/'
          return
        }
        await load()
      } else {
        showToast(d.error || '操作失败')
      }
    } catch {
      showToast('网络错误，稍后再试')
    }
    setBusy(false)
  }

  if (!info) {
    return (
      <div className="page">
        <NavBar />
        <div className="empty-state">正在读取调试状态…</div>
      </div>
    )
  }

  if (!info.available) {
    return (
      <div className="page">
        <div className="page-head"><h1>调试</h1></div>
        <NavBar />
        <div className="card empty-state">
          <p>🔒 {info.reason}</p>
        </div>
      </div>
    )
  }

  const d = info.data || {}
  const clk = info.clock || {}
  const env = info.env || {}
  const me = info.me || {}
  const cache = d.cache || {}
  const persona = d.personaDocs || {}

  const kv = (label, value) => (
    <div className="kv"><span>{label}</span><b>{value}</b></div>
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1>调试</h1>
        <span className="sub">运行时调试面板 · 改完记得归零/清理</span>
      </div>
      <NavBar />

      {/* 环境信息 */}
      <div className="card">
        <h2>🖥 环境</h2>
        <div className="kv-list">
          {kv('运行模式', env.nodeEnv === 'development' ? 'development（调试全开）' : 'production')}
          {kv('DEBUG_ENABLED', env.debugEnabled ? '1' : '0')}
          {kv('DeepSeek 引擎', env.mockEngine ? 'Mock 规则版（无 Key）' : 'LLM（有 Key）✓')}
          {kv('心情卡 Kimi', env.hasMoonshotKey ? '已启用' : '未启用（规则版）')}
          {kv('当前身份', `${me.username}（id=${me.id} · ${me.role}）`)}
        </div>
      </div>

      {/* 时钟调试 */}
      <div className="card">
        <h2>🕐 模拟日期（偏移"今天"）</h2>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px', lineHeight: 1.8 }}>
          偏移量 = 服务端"现在"前移/后移的天数。影响：日记当天、6:00 划日、日报生成、每日问题、目标按天逻辑等所有服务端日期计算。进程重启后归零。
          <br />可输小数：0.25 天 ≈ 6 小时（本地时区 6:00 划日边界可测，如 -0.7 天 ≈ 跨过凌晨）。
        </p>
        <div className="kv-list">
          {kv('当前偏移', `${clk.offsetDays ?? 0} 天`)}
          {kv('模拟现在(本地)', clk.localNow || '—')}
          {kv('模拟今天(UTC)', clk.fakeTodayISO || '—')}
          {kv('6:00 划日 todayKey', clk.todayKey || '—')}
          {kv('6:00 划日 昨天', clk.yesterdayKey || '—')}
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: 'setClock', offsetDays: (clk.offsetDays || 0) - 1 }, '已回拨 1 天')}>-1 天</button>
          <input
            type="number"
            value={offsetInput}
            onChange={(e) => setOffsetInput(e.target.value)}
            style={{ width: 90, padding: '8px 10px', fontSize: 13 }}
            min={-366}
            max={366}
            step={0.25}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => act({ action: 'setClock', offsetDays: Number(offsetInput) }, '时钟已偏移 ✓')}>应用偏移</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: 'setClock', offsetDays: (clk.offsetDays || 0) + 1 }, '已拨快 1 天')}>+1 天</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: 'setClock', offsetDays: 0 }, '时钟已归零 ✓')}>归零</button>
        </div>
      </div>

      {/* 报告缓存 */}
      <div className="card">
        <h2>🗂 报告缓存</h2>
        <div className="kv-list">
          {kv('最新日报缓存', cache.latestReport ? `有（dayKey=${cache.latestDayKey}）` : '无（下次访问重新生成）')}
          {kv('历史日报缓存', `${cache.historyReports} 份`)}
          {kv('周期报告缓存', `${cache.periodReports} 份`)}
        </div>
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: 'clearCache', scope: 'latest' }, '已清最新日报缓存')}>清最新</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: 'clearCache', scope: 'history' }, '已清历史日报缓存')}>清历史</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: 'clearCache', scope: 'period' }, '已清周期报告缓存')}>清周期</button>
          <button className="btn btn-r" disabled={busy} onClick={() => act({ action: 'clearCache', scope: 'all' }, '全部报告缓存已清')}>全部清空</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>清空后访问 /report 会按当前（模拟）日期重新生成。</p>
      </div>

      {/* 夜间作业 */}
      <div className="card">
        <h2>🌙 6:00 夜间作业</h2>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px', lineHeight: 1.8 }}>
          手动触发"昨天的日报预生成 + 进化收尾（instinct 衰减 + persona 三文档重建）"。默认处理 6:00 划日的昨天；jobs 表幂等。
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => act({ action: 'runOvernight' }, '夜间作业已执行 ✓')}>执行（当前账号）</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: 'runOvernight', force: true }, '强制重跑 ✓')}>强制重跑</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: 'runOvernightAll' }, '已对所有账号执行 ✓')}>执行（全部账号）</button>
        </div>
      </div>

      {/* 对话抽取 */}
      <div className="card">
        <h2>💬 待抽取对话</h2>
        <div className="kv-list">
          {kv('会话数', d.chatSessionCount ?? 0)}
          {kv('待抽取消息', d.pendingChats ?? 0)}
          {kv('画像生成中', d.generating ? '是（有后台链在执行）' : '否')}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !d.pendingChats} onClick={() => act({ action: 'consumeChats' }, '对话已并入画像 ✓')}>
          立即并入画像
        </button>
      </div>

      {/* 用户切换 */}
      <div className="card">
        <h2>👥 切换用户</h2>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px', lineHeight: 1.8 }}>
          以任意账号身份登录（写会话 cookie，切换后跳回主页）。多账号测试无需反复登出。
        </p>
        <div className="kv-list">
          {(info.users || []).map((u) => (
            <div key={u.id} className="kv" style={{ alignItems: 'center' }}>
              <span>
                {u.id === me.id ? '▶ ' : ''}{u.username} <span className="muted" style={{ fontSize: 11 }}>（{u.role} · {u.dayCount} 天 · {u.chatCount} 会话）</span>
              </span>
              {u.id === me.id ? (
                <b style={{ color: 'var(--yellow)' }}>当前</b>
              ) : (
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act({ action: 'loginAs', userId: u.id }, `已切换到 ${u.username}`)}>
                  切换
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 数据概况 */}
      <div className="card">
        <h2>📊 当前账号数据</h2>
        <div className="kv-list">
          {kv('记录天数', d.dayCount ?? 0)}
          {kv('画像主题', d.topicCount ?? 0)}
          {kv('目标', `${d.activeGoalCount ?? 0} 进行中 / ${d.goalCount ?? 0} 全部`)}
          {kv('测试报告', d.testCount ?? 0)}
          {kv('建议采纳存证', d.adoptionCount ?? 0)}
          {kv('反馈存证', d.feedbackCount ?? 0)}
          {kv('情绪序列', d.emotionSeriesCount ?? 0)}
          {kv('危机标记', d.crisisFlag ? '有 ⚠' : '无')}
          {kv('进化资产', `self ${persona.self ?? 0} 字 · persona ${persona.persona ?? 0} 字 · working ${persona.working ?? 0} 字`)}
          {kv('本能条目', d.personaInstincts ?? 0)}
        </div>
      </div>

      {/* 危险区 */}
      <div className="card danger-zone">
        <h2 style={{ color: 'var(--red)' }}>⚠ 危险区</h2>
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px', lineHeight: 1.8 }}>
          重置当前账号：清空画像、日记、对话、事件流、进化资产、报告缓存与作业记录（账号与密码保留）。不可恢复，请确认后执行。
        </p>
        <button
          className="btn btn-r"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`确定重置账号「${me.username}」的全部数据？此操作不可恢复。`)) {
              act({ action: 'resetProfile' }, '账号数据已重置 ✓')
            }
          }}
        >
          重置当前账号画像
        </button>
      </div>

      {/* 快捷跳转 */}
      <div className="card">
        <h2>🔗 快捷跳转</h2>
        <div className="home-quick" style={{ marginTop: 4 }}>
          <Link href="/report?range=week" className="q"><i>📅</i>本周回顾</Link>
          <Link href="/report" className="q"><i>📜</i>报告</Link>
          <Link href="/settings" className="q"><i>⚙️</i>设置</Link>
          <Link href="/admin" className="q"><i>🛠</i>管理后台</Link>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
