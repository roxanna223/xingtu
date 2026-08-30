'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'

export default function HomePage() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then(setStatus)
  }, [])

  const hour = new Date().getHours()
  const greet = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const greetEn = hour < 6 ? 'LATE NIGHT' : hour < 12 ? 'GOOD MORNING' : hour < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING'
  const user = status?.user
  const days = status?.dayCount ?? 0

  // 状态条：由记录天数派生的展示值（纯视觉）
  const hp = Math.min(96, 52 + days * 2)
  const mp = Math.min(96, 46 + days * 3)
  const xp = Math.min(96, 20 + days * 6)

  return (
    <div className="page">
      <NavBar />

      <div className="home-hello">
        <div className="home-ava">{(user?.username || '…')[0]}</div>
        <div>
          <div className="px" style={{ fontSize: 8, color: 'var(--dim)' }}>{greetEn}</div>
          <div style={{ fontWeight: 800, fontSize: 17, marginTop: 5, letterSpacing: 1 }}>
            {user?.username || '…'}{' '}
            <span className="tag" style={{ borderColor: 'var(--yellow)', color: 'var(--yellow)' }}>
              {user?.starSymbol ? `${user.starSymbol} ${user.starSign || ''}` : '✦ 星海某处'}
            </span>
          </div>
        </div>
        <span className="px" style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--dim)' }}>
          DAY {days}
        </span>
      </div>

      <div className="card px-stats">
        <div className="px-stat"><span className="ic">❤️</span><span className="lb">心力</span><div className="bar bar-hp"><i style={{ width: `${hp}%` }} /></div><span className="vl">{hp}/100</span></div>
        <div className="px-stat"><span className="ic">🔮</span><span className="lb">能量</span><div className="bar bar-mp"><i style={{ width: `${mp}%` }} /></div><span className="vl">{mp}/100</span></div>
        <div className="px-stat"><span className="ic">⭐</span><span className="lb">星光</span><div className="bar bar-xp"><i style={{ width: `${xp}%` }} /></div><span className="vl">{days} 天</span></div>
      </div>

      {/* P0-1 首次使用引导：还没记录过 → 三步新手指引 */}
      {days === 0 && (
        <div className="card" style={{ borderColor: 'var(--green)', marginBottom: 14, padding: '16px' }}>
          <h2 style={{ margin: '0 0 8px' }}>🌱 欢迎登舰</h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.9, fontSize: 13 }}>
            星图需要 <b style={{ color: 'var(--yellow)' }}>3 天记录</b> 才能点亮你的第一张内心星图：<br />
            ① 今天写一句话（点「写日记」，一句话就行）→ ② 或找小星聊聊 → ③ 明晚回来，看第一颗星星亮起
          </p>
        </div>
      )}

      {/* P0-1 首图进度：已记录但未满 3 天 → 进度提示 */}
      {days > 0 && days < 3 && (
        <div className="card" style={{ borderColor: 'var(--yellow)', marginBottom: 14, padding: '12px 16px' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1 }}>🌱 首图进度 {days}/3</span>
            <span className="muted" style={{ fontSize: 12 }}>再记录 {3 - days} 天，点亮你的第一张星图</span>
          </div>
          <div className="bar bar-xp" style={{ height: 12 }}>
            <i style={{ width: `${(days / 3) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="card home-hero">
        <div className="px" style={{ fontSize: 8, color: 'var(--yellow)' }}>TONIGHT BRIEF</div>
        <h2>
          {greet}，{user?.username || '旅人'}。<br />
          今晚也<b>留一盏灯</b>给自己。
        </h2>
        <p>
          星图已经陪你走过 {days} 天。说几句也好，只看不记也好——它不催你。
          {!status?.hasKey && <span className="muted">（当前 Mock 引擎，配置 API Key 后切换在线引擎）</span>}
        </p>
      </div>

      <div className="home-cards">
        <Link href="/chat" className="home-card">
          <span className="h-icon">💬</span>
          <div>
            <h2>和小星聊聊</h2>
            <p className="muted">陪伴对话 · 测验 · 帮你理一理今天</p>
          </div>
          <span className="arr">▶</span>
        </Link>

        <Link href="/diary" className="home-card">
          <span className="h-icon">📖</span>
          <div>
            <h2>写日记</h2>
            <p className="muted">今天的归档 · 写多少都行</p>
          </div>
          <span className="arr">▶</span>
        </Link>
      </div>

      <div className="sec-title">— SHORTCUTS · 快捷入口 —</div>
      <div className="home-quick">
        <Link href="/report" className="q"><i>📜</i>今日报告</Link>
        <Link href="/report?range=week" className="q"><i>📅</i>周期回顾</Link>
        <Link href="/goals" className="q"><i>🎯</i>目标计划</Link>
        <Link href="/star-map" className="q"><i>🌌</i>内心星图</Link>
        <Link href="/tests" className="q"><i>🎒</i>测验记录</Link>
      </div>
    </div>
  )
}
