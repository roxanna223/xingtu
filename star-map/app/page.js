'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import { EMO_COLORS } from '@/lib/colors'

export default function HomePage() {
  const [status, setStatus] = useState(null)
  const [goalsData, setGoalsData] = useState(null)

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then(setStatus)
    fetch('/api/goals').then((r) => r.json()).then(setGoalsData)
  }, [])

  const hour = new Date().getHours()
  const greetEn = hour < 6 ? 'LATE NIGHT' : hour < 12 ? 'GOOD MORNING' : hour < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING'
  const user = status?.user
  const days = status?.dayCount ?? 0
  const moodTrail = status?.moodTrail || []
  const todayStep = goalsData?.todayStep || null

  return (
    <div className="page">
      <NavBar />

      <div className="home-hello">
        <div className="home-ava">{(user?.username || '…')[0]}</div>
        <div>
          <div className="px" style={{ fontSize: 8, color: 'var(--dim)' }}>{greetEn}</div>
          <div style={{ fontWeight: 800, fontSize: 17, marginTop: 5, letterSpacing: 1 }}>
            {user?.username || '…'}
          </div>
        </div>
        <span className="px" style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--dim)' }}>
          DAY {days}
        </span>
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
        <div className="px" style={{ fontSize: 8, color: 'var(--green)' }}>TODAY'S STEP · 今天的一步</div>

        {/* 我在哪：最近情绪轨迹（真实数据） */}
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>我在哪 · 最近：</span>
          {moodTrail.length > 0 ? (
            moodTrail.map((m, i) => (
              <span key={i} className="chip on" style={{ fontSize: 12, borderColor: EMO_COLORS[m.emotion] || 'var(--dim)', color: EMO_COLORS[m.emotion] || 'var(--dim)' }}>
                {m.date.slice(5)} {m.emotion}
              </span>
            ))
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>还没有记录</span>
          )}
        </div>

        {/* 差什么 + 走了吗：进行中目标的最小一步（真实数据） */}
        {todayStep ? (
          <>
            <h2 style={{ margin: '12px 0 6px', fontSize: 16 }}>「{todayStep.goalTitle}」差这一步</h2>
            <p style={{ fontSize: 14, margin: 0, lineHeight: 1.8 }}>
              {todayStep.step}
              <span className="muted">（{todayStep.metric}）</span>
            </p>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: 12, color: todayStep.doneToday ? 'var(--green)' : 'var(--yellow)' }}>
                {todayStep.doneToday
                  ? '✓ 今天的这一步已经走了'
                  : todayStep.idleDays >= 3
                    ? `⏳ 今天这一步还没走 · 目标 ${todayStep.idleDays} 天没更新了`
                    : '⏳ 今天这一步还没走'}
              </span>
              <Link className="btn btn-primary btn-sm" href="/goals">
                {todayStep.doneToday ? '看看进度' : '去走这一步'}
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ margin: '12px 0 6px', fontSize: 16 }}>差一步：先说出你想成为的样子</h2>
            <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.8 }}>
              {days === 0
                ? '今天先写一句话，让星图看见你。'
                : '定一个目标，星图把它拆成一步步，你每天打开就能看见"今天差哪一步"。'}
            </p>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <Link className="btn btn-primary btn-sm" href="/goals">🎯 定目标</Link>
              <Link className="btn btn-ghost" href="/diary">写一句今天</Link>
            </div>
          </>
        )}
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
