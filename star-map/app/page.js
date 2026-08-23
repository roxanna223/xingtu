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
        <div className="px-stat"><span className="ic">⭐</span><span class="lb">星光</span><div className="bar bar-xp"><i style={{ width: `${xp}%` }} /></div><span className="vl">{days} 天</span></div>
      </div>

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
        <Link href="/record" className="home-card">
          <span className="h-icon">🗺️</span>
          <div>
            <h2>记录星图</h2>
            <p className="muted">把今天存档 · 聊几句或直接填</p>
          </div>
          <span className="arr">▶</span>
        </Link>

        <Link href="/chat" className="home-card">
          <span className="h-icon">💬</span>
          <div>
            <h2>和小星聊聊</h2>
            <p className="muted">陪伴对话 · 测验 · 树洞</p>
          </div>
          <span className="arr">▶</span>
        </Link>
      </div>

      <div className="sec-title">— SHORTCUTS · 快捷入口 —</div>
      <div className="home-quick">
        <Link href="/report" className="q"><i>📜</i>今日报告</Link>
        <Link href="/star-map" className="q"><i>🌌</i>内心星图</Link>
        <Link href="/tests" className="q"><i>🎒</i>测验记录</Link>
      </div>
    </div>
  )
}
