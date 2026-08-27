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

/** 与后端一致的达标次数口径：取 metric 最后一个数字，默认 1 */
function needCount(metric) {
  const m = String(metric || '').match(/\d+/g)
  return m && m.length ? Number(m[m.length - 1]) : 1
}

export default function GoalsPage() {
  const [goals, setGoals] = useState([])
  const [summary, setSummary] = useState([])
  const [phase, setPhase] = useState('loading')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState(null) // { goalId, stepIndex, mode:'journal'|'note', text }

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
        showToast(`目标「${d.goal.title}」已拆解为 ${d.goal.steps.length} 步 🎯`)
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
        setForm(null)
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

  function streakOf(step) {
    const logs = step.logs || []
    if (!logs.length) return 0
    const days = [...new Set(logs.map((l) => l.date))].sort()
    const today = new Date().toISOString().slice(0, 10)
    if (days.at(-1) !== today) return 0
    let n = 0
    for (let k = days.length - 1; k >= 0; k--) {
      if (days[k] === new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)) n++
      else break
    }
    return n
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>计划</h1>
        <span className="sub">主观任务写一写 · 客观任务点完成 · 达标自动进阶{summary.length > 0 ? ` · 进行中 ${summary.length} 个` : ''}</span>
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
            主观任务写一写、客观任务点完成，每天都有新彩蛋；记录与聊天也会自动同步进度。
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
                    <div className="bonus-done">✓ 已领，明天有新彩蛋</div>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => act({ action: 'bonusDone', goalId: g.id }, '彩蛋完成 🎁')}>
                      完成它
                    </button>
                  )}
                </div>
              )}

              <div className="goal-steps">
                {g.steps.map((s, i) => {
                  const log = todayLog(s)
                  const streakN = streakOf(s)
                  const doneCount = new Set((s.logs || []).map((l) => l.date)).size
                  const need = needCount(s.metric)
                  const open = form && form.goalId === g.id && form.stepIndex === i
                  const isJournal = s.type === 'journal'
                  return (
                    <div key={i} className={`goal-step ${s.status === 'done' ? 'done' : ''}`}>
                      <span className="goal-idx">{s.status === 'done' ? '✓' : i + 1}</span>
                      <div style={{ flex: 1 }}>
                        <div className="goal-text">
                          {s.step}
                          <span className="goal-tag">{isJournal ? '✍️ 主观' : '☑️ 客观'}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {s.doneAt
                            ? `${s.doneAt} 完成`
                            : doneCount > 0
                              ? `${s.metric} · 已 ${Math.min(doneCount, need)}/${need}${streakN >= 2 ? ` · 🔥连续 ${streakN} 天` : ''}`
                              : s.metric}
                        </div>
                        {log && (
                          <div className="step-log">
                            ✓ 今日已{isJournal ? '记录' : '完成'}：{log.text || '完成'}
                          </div>
                        )}
                        {open && (
                          <div className="record-form">
                            {(s.options || []).length > 0 && (
                              <div className="record-chips">
                                {(s.options || []).map((o) => (
                                  <button
                                    key={o}
                                    className={form.text === o ? 'record-chip on' : 'record-chip'}
                                    onClick={() => setForm((f) => ({ ...f, text: o }))}
                                  >
                                    {o}
                                  </button>
                                ))}
                              </div>
                            )}
                            <input
                              type="text"
                              value={form.text}
                              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
                              placeholder={form.mode === 'note' ? '补一句备注（可选）' : isJournal ? '写一写今天的情况（或点上面选项）' : '备注（可选）'}
                              maxLength={300}
                            />
                            <div className="row" style={{ marginTop: 8, gap: 8 }}>
                              <button
                                className="btn btn-primary"
                                onClick={() =>
                                  act(
                                    { action: form.mode === 'note' ? 'stepNote' : 'stepRecord', goalId: g.id, stepIndex: i, text: form.text },
                                    form.mode === 'note' ? '备注已保存' : isJournal ? '已记录 ✓' : '已完成 ✓'
                                  )
                                }
                              >
                                {form.mode === 'note' ? '保存备注' : isJournal ? '提交记录' : '完成'}
                              </button>
                              <button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {g.status === 'active' && s.status === 'todo' && !open && (
                        <div className="step-actions">
                          {log ? (
                            <button className="login-skip" onClick={() => setForm({ goalId: g.id, stepIndex: i, mode: 'note', text: log.text || '' })}>
                              ✏️ 备注
                            </button>
                          ) : isJournal ? (
                            <button className="btn btn-primary btn-sm" onClick={() => setForm({ goalId: g.id, stepIndex: i, mode: 'journal', text: '' })}>
                              ✍️ 写一写
                            </button>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => act({ action: 'stepRecord', goalId: g.id, stepIndex: i, text: '' }, '已完成 ✓')}
                            >
                              ✓ 完成
                            </button>
                          )}
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
