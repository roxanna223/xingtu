'use client'

import { useEffect, useState } from 'react'
import NavBar from '@/components/NavBar'

const SRC_ICON = { create: '✨', record: '🗺️', chat: '💬', manual: '✋' }
const SRC_NAME = { create: '创建', record: '记录同步', chat: '聊天同步', manual: '手动' }
const TYPE_NAME = { created: '目标建立', step_done: '完成一步', step_reopen: '重新打开', mention: '相关进展', archived: '归档' }

export default function GoalsPage() {
  const [goals, setGoals] = useState([])
  const [summary, setSummary] = useState([])
  const [phase, setPhase] = useState('loading')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function load() {
    try {
      const r = await fetch('/api/goals')
      if (!r.ok) throw new Error(String(r.status))
      const d = await r.json()
      setGoals(d.goals || [])
      setSummary(d.summary || [])
      setPhase('ready')
    } catch {
      setPhase('error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function create(e) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', text: text.trim() }),
      })
      const d = await r.json()
      if (d.ok) {
        setText('')
        showToast(`目标「${d.goal.title}」已拆解为 ${d.goal.steps.length} 步，加入计划栏目 🎯`)
        await load()
      } else {
        showToast(d.error || '创建失败，换个说法试试')
      }
    } catch {
      showToast('网络错误，稍后再试')
    }
    setBusy(false)
  }

  async function act(payload, okMsg) {
    try {
      const r = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (d.ok) {
        showToast(okMsg)
        await load()
      } else {
        showToast(d.error || '操作失败')
      }
    } catch {
      showToast('网络错误，稍后再试')
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>计划</h1>
        <span className="sub">你的目标 · 拆解路径 · 完成轨迹{summary.length > 0 ? ` · 进行中 ${summary.length} 个` : ''}</span>
      </div>
      <NavBar />

      <form className="card goal-create" onSubmit={create}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="我想定个目标：比如「改掉熬夜」或「三个月转行成功」"
          maxLength={200}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
          {busy ? '拆解中…' : '🎯 定下目标'}
        </button>
      </form>

      {phase === 'loading' && (
        <div className="card empty-state">
          <div className="spinner" />
        </div>
      )}
      {phase === 'error' && (
        <div className="card empty-state">
          <p>加载失败，稍后再试。</p>
          <button className="btn" onClick={load}>重新加载</button>
        </div>
      )}

      {phase === 'ready' && goals.length === 0 && (
        <div className="card empty-state">
          <p style={{ fontSize: 15, marginBottom: 8 }}>还没有目标。</p>
          <p className="muted" style={{ lineHeight: 1.9 }}>
            在上面输入一个你想改变/达成的事，星图会把它拆成带量化指标的步骤。<br />
            之后你每天的记录、和小星的聊天，都会自动更新目标的完成轨迹。
          </p>
        </div>
      )}

      {phase === 'ready' &&
        goals.map((g) => {
          const doneSteps = g.steps.filter((s) => s.status === 'done').length
          const pct = g.steps.length ? Math.round((doneSteps / g.steps.length) * 100) : 0
          const statusLabel = g.status === 'done' ? '已完成 🎉' : g.status === 'archived' ? '已归档' : '进行中'
          return (
            <div key={g.id} className="card goal-page-card">
              <div className="goal-head">
                <div>
                  <div className="goal-title">🎯 {g.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {statusLabel} · {g.createdAt} 建立{g.summary ? ` · ${g.summary}` : ''}
                  </div>
                </div>
                {g.status === 'active' && (
                  <button className="login-skip" onClick={() => act({ action: 'archive', goalId: g.id }, `已归档「${g.title}」`)}>
                    归档
                  </button>
                )}
                {g.status === 'archived' && (
                  <button className="login-skip" onClick={() => act({ action: 'delete', goalId: g.id }, '已删除')}>
                    删除
                  </button>
                )}
              </div>

              <div className="goal-bar-row">
                <div className="goal-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{doneSteps}/{g.steps.length} 步</span>
              </div>

              <div className="goal-steps">
                {g.steps.map((s, i) => (
                  <div key={i} className={`goal-step ${s.status === 'done' ? 'done' : ''}`}>
                    <span className="goal-idx">{s.status === 'done' ? '✓' : i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div className="goal-text">{s.step}</div>
                      <div className="muted" style={{ fontSize: 12 }}>指标：{s.metric}{s.doneAt ? ` · ${s.doneAt} 完成` : ''}</div>
                    </div>
                    {g.status === 'active' && (
                      <button
                        className="login-skip"
                        onClick={() =>
                          act(
                            { action: 'toggleStep', goalId: g.id, stepIndex: i, done: s.status !== 'done' },
                            s.status === 'done' ? '已重新打开这一步' : `完成！「${s.metric}」记入轨迹`
                          )
                        }
                      >
                        {s.status === 'done' ? '↩ 重开' : '完成 ✓'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {(g.progress || []).length > 0 && (
                <div className="goal-tl">
                  <div className="sec-title">— 完成轨迹 —</div>
                  {[...(g.progress || [])].reverse().slice(0, 12).map((p, i) => (
                    <div key={i} className="goal-tl-item">
                      <span className="goal-tl-icon">{SRC_ICON[p.source] || '·'}</span>
                      <div>
                        <span className="goal-tl-head">
                          {p.date} · {TYPE_NAME[p.type] || p.type}
                          <span className="muted" style={{ marginLeft: 6 }}>（{SRC_NAME[p.source] || p.source}）</span>
                        </span>
                        {p.note && <div className="muted" style={{ fontSize: 12 }}>{p.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
