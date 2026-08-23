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
  const user = status?.user

  return (
    <div className="page">
      <div className="page-head">
        <h1>星图</h1>
        <span className="sub">看见 → 理解 → 指路</span>
      </div>
      <NavBar />

      <p style={{ fontSize: 18, margin: '6px 0 18px' }}>
        {greet}，{user?.starSymbol ? `${user.starSymbol} ` : '✦ '}
        <b style={{ color: '#f5c76a' }}>{user?.username || '…'}</b>
        {user?.starSign ? <span className="muted">（{user.starSign}座）</span> : null}
      </p>

      <div className="home-cards">
        <Link href="/record" className="home-card">
          <div className="h-icon">📝</div>
          <h2>记录星图</h2>
          <p className="muted">聊几句或直接填写，把今天理清楚，落进你的星图。</p>
          <span className="h-more">去记录 →</span>
        </Link>

        <Link href="/chat" className="home-card home-card-star">
          <div className="h-icon">⭐</div>
          <h2>和小星聊聊</h2>
          <p className="muted">基于你的星图陪你聊：话题、情绪、还能测一测。</p>
          <span className="h-more">去找小星 →</span>
        </Link>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <span className="pill">已记录 {status?.dayCount ?? 0} 天</span>
        <Link href="/report" className="pill" style={{ textDecoration: 'none' }}>今日报告 →</Link>
        <Link href="/tests" className="pill" style={{ textDecoration: 'none' }}>测试报告 →</Link>
      </div>
    </div>
  )
}
