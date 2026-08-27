'use client'

import { useEffect, useState } from 'react'
import NavBar from '@/components/NavBar'

const SRC_ICON = { create: '✨', record: '🗺️', chat: '💬', manual: '✋' }
const SRC_NAME = { create: '创建', record: '记录同步', chat: '聊天同步', manual: '手动' }
const TYPE_NAME = {
  created: '目标建立',
  step_done: '完成一步',
  step_reopen: '重新打开',
  mention: '相关进展',
  archived: '归档',
  checkin: '打卡',
  journal: '记录',
  bonus: '彩蛋完成',
  goal_done: '目标达成',
}
const LEVEL_ICON = { 起步: '🌱', 铜星: '🥉', 银星: '🥈', 金星: '🥇' }

export default function GoalsPage() {
  const [goals, setGoals] = useState([])
  const [summary, setSummary] = useState([])
  const [phase, setPhase] = useState('loading')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [recForm, setRecForm] = useState(null) // { goalId, stepIndex, text }

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
        setRecForm(null)
        await load()
      } else {
        showToast(d.error || '操作失败')
      }
    } catch {
      showToast('网络错误，稍后再试')
    }
  }

  function todayLog(step) {
    const today = new Date().toISOString().slice(0, 10)
    return (step.logs || []).find((l) => l.date === today) || null
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>计划</h1>
        <span className="sub">每日计划 · 打卡记录 · 彩蛋任务 · 积分激励{summary.length > 0 ? ` · 进行中 ${summary.length} 个` : ''}</span>
      </div>
      <NavBar />

      <form className="card goal-create" onSubmit={create}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="我想定个目标：比如「一个月减 5 斤」或「三个月转行成功」"
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
            每天打卡/记录会累积积分，还有每天刷新的彩蛋小任务；记录与聊天也会自动同步进度。
          </p>
        </div>
      )}

      {phase === 'ready' &&
        goals.map((g) => {
          const doneSteps = g.steps.filter((s) => s.status === 'done').length
          const pct = g.steps.length ? Math.round((doneSteps / g.steps.length) * 100) : 0
          const statusLabel = g.status === 'done' ? '已完成 🎉' : g.status === 'archived' ? '已归档' : '进行中'
          const level = g.points >= 300 ? '金星' : g.points >= 150 ? '银星' : g.points >= 50 ? '铜星' : '起步'
          const bonus = g.dailyBonus
          const bonusToday = bonus && bonus.date === new Date().toISOString().slice(0, 10)
          return (
            <div key={g.id} className="card goal-page-card">
              <div className="goal-head">
                <div>
                  <div className="goal-title">
                    🎯 {g.title}
                    <span className="goal-level"> {LEVEL_ICON[level] || '🌱'} {level} · ⭐{g.points}分</span>
                  </div>
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

              {g.status === 'active' && bonusToday && (
                <div className={`bonus-card ${bonus.doneAt ? 'done' : ''}`}>
                  <div className="bonus-head">
                    <span>🎁 今日彩蛋任务</span>
                    <span className="bonus-pts">+{bonus.points} 分</span>
                  </div>
                  <div className="bonus-task">{bonus.task}</div>
                  {bonus.flavor && <div className="muted" style={{ fontSize: 11 }}>{bonus.flavor}</div>}
                  {bonus.doneAt ? (
                    <div className="bonus-done">✓ 已领 +{bonus.points} 分，明天有新彩蛋</div>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => act({ action: 'bonusDone', goalId: g.id }, `彩蛋完成 +${bonus.points} 分 🎁`)}>
                      完成它 +{bonus.points}
                    </button>
                  )}
                </div>
              )}

              <div className="goal-steps">
                {g.steps.map((s, i) => {
                  const log = todayLog(s)
                  const streakN = (s.logs || []).length
                    ? (() => {
                        const days = [...new Set(s.logs.map((l) => l.date))].sort()
                        const today = new Date().toISOString().slice(0, 10)
                        if (days.at(-1) !== today) return 0
                        let n = 0
                        for (let k = days.length - 1; k >= 0; k--) {
                          if (days[k] === new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)) n++
                          else break
                        }
                        return n
                      })()
                    : 0
                  const open = recForm && recForm.goalId === g.id && recForm.stepIndex === i
                  return (
                    <div key={i} className={`goal-step ${s.status === 'done' ? 'done' : ''}`}>
                      <span className="goal-idx">{s.status === 'done' ? '✓' : i + 1}</span>
                      <div style={{ flex: 1 }}>
                        <div className="goal-text">{s.step}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          指标：{s.metric}
                          {s.doneAt ? ` · ${s.doneAt} 完成` : streakN >= 2 ? ` · 🔥 连续 ${streakN} 天` : ''}
                        </div>
                        {log && <div className="step-log">📝 今天：{log.text}{log.points ? `（+${log.points}分）` : ''}</div>}
                        {open && (
                          <div className="record-form">
                            {(s.options || []).length > 0 && (
                              <div className="record-chips">
                                {(s.options || []).map((o) => (
                                  <button
                                    key={o}
                                    className={recForm.text === o ? 'record-chip on' : 'record-chip'}
                                    onClick={() => setRecForm((f) => ({ ...f, text: o }))}
                                  >
                                    {o}
                                  </button>
                                ))}
                              </div>
                            )}
                            <input
                              type="text"
                              value={recForm.text}
                              onChange={(e) => setRecForm((f) => ({ ...f, text: e.target.value }))}
                              placeholder={s.type === 'journal' ? '记录一下今天的情况（或点上面选项）' : '备注（可选）'}
                              maxLength={300}
                            />
                            <div className="row" style={{ marginTop: 8, gap: 8 }}>
                              <button
                                className="btn btn-primary"
                                onClick={() => act({ action: 'stepRecord', goalId: g.id, stepIndex: i, text: recForm.text }, s.type === 'journal' ? '已记录 +10 分 📝' : '已打卡 +5 分 🔥')}
                              >
                                提交{s.type === 'journal' ? '（+10）' : '（+5）'}
                              </button>
                              <button className="btn btn-ghost" onClick={() => setRecForm(null)}>取消</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {g.status === 'active' && s.status === 'todo' && !open && (
                        <div className="step-actions">
                          {log ? (
                            <span className="muted" style={{ fontSize: 12 }}>已打卡 ✓</span>
                          ) : (
                            <button className="login-skip" onClick={() => setRecForm({ goalId: g.id, stepIndex: i, text: '' })}>
                              {s.type === 'journal' ? '✍️ 记录 +10' : '🔥 打卡 +5'}
                            </button>
                          )}
                          <button
                            className="login-skip muted"
                            onClick={() => act({ action: 'toggleStep', goalId: g.id, stepIndex: i, done: true }, '已直接标记完成')}
                          >
                            直接完成
                          </button>
                        </div>
                      )}
                      {g.status === 'active' && s.status === 'done' && (
                        <button className="login-skip" onClick={() => act({ action: 'toggleStep', goalId: g.id, stepIndex: i, done: false }, '已重新打开这一步')}>
                          ↩ 重开
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {(g.pointsLedger || []).length > 0 && (
                <div className="goal-tl">
                  <div className="sec-title">— 积分明细（最近 5 条）—</div>
                  {[...(g.pointsLedger || [])].reverse().slice(0, 5).map((l, i) => (
                    <div key={i} className="goal-tl-item">
                      <span className="goal-tl-icon">⭐</span>
                      <div>
                        <span className="goal-tl-head">
                          {l.date} · {l.note}
                          <b style={{ marginLeft: 6, color: 'var(--green)' }}>+{l.delta}</b>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

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
