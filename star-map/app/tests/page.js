'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'

export default function TestsPage() {
  const [tests, setTests] = useState(null)

  useEffect(() => {
    fetch('/api/tests').then((r) => r.json()).then((d) => setTests(d.tests || []))
  }, [])

  return (
    <div className="page">
      <div className="page-head">
        <h1>测试报告</h1>
        <span className="sub">你在小星那里测过的一切</span>
      </div>
      <NavBar />

      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <b style={{ fontSize: 15 }}>📋 每日状态报告</b>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>每一天的完整报告（状态判定 / 根因链 / 路径建议）都在这里。</p>
        </div>
        <Link href="/report" className="btn btn-primary" style={{ textDecoration: 'none', flexShrink: 0 }}>查看每日报告</Link>
      </div>

      {tests === null ? (
        <div className="card empty-state"><div className="spinner" /></div>
      ) : tests.length === 0 ? (
        <div className="empty-state">
          还没有测试记录。<br />
          <span className="muted">去找小星说"测一测我是什么花"吧。</span>
          <br /><br />
          <Link href="/chat" className="btn btn-primary" style={{ textDecoration: 'none' }}>去找小星</Link>
        </div>
      ) : (
        <div>
          {tests.map((t, i) => (
            <div key={i} className="result-card" style={{ marginBottom: 16 }}>
              <div className="result-emoji">{t.emoji}</div>
              <div className="result-title">{t.title}</div>
              <div className="result-headline">“{t.headline}”</div>
              <p className="result-content">{t.content}</p>
              <div className="muted" style={{ fontSize: 12 }}>{t.date}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
