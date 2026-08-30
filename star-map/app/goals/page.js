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
  const [form, setForm] = useState(null) // { goalId, stepIndex, subIndex, mode:'journal'|'note', text }

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

  return (
    <div className="page">
      <div className="page-head">
        <h1>计划</h1>
        <span className="sub">主观题填数据 · 客观题一键完成 · 达标自动进阶{summary.length > 0 ? ` · 进行中 ${summary.length} 个` : ''}</span>
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
            主观任务写一写、客观任务点完成；记录与聊天也会自动同步进度。
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
                  <div className="goal-title">
                    🎯 {g.title}
                    <span className="goal-tag" style={{ marginLeft: 6 }}>{g.period === 'weekly' ? '📅 周更' : g.period === 'monthly' ? '🗓️ 月更' : '☀️ 日更'}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {statusLabel} · {g.createdAt} 建立{g.period !== 'daily' ? ' · 按周期检查，不用每天追' : ''}{g.summary ? ` · ${g.summary}` : ''}
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
                {g.steps.map((s, i) => {
                  const log = todayLog(s)
                  const doneCount = new Set((s.logs || []).map((l) => l.date)).size
                  const need = needCount(s.metric)
                  const open = form && form.goalId === g.id && form.stepIndex === i
                  const isJournal = s.type === 'journal'
                  const today = new Date().toISOString().slice(0, 10)
                  const subs = s.subItems || []
                  const subDoneToday = (x) => x.doneAt === today
                  const subsAllDone = subs.length > 0 && subs.every(subDoneToday)
                  const subDoneCount = subs.filter(subDoneToday).length
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
                              ? `${s.metric} · 已 ${Math.min(doneCount, need)}/${need}`
                              : s.metric}
                        </div>

                        {subs.length > 0 && (
                          <div className="subitem-row">
                            {subs.map((sub, si) => {
                              const done = subDoneToday(sub)
                              return done ? (
                                <span key={si} className="subitem-chip done" title={sub.text || ''}>
                                  ✓ {sub.name}
                                </span>
                              ) : (
                                <button
                                  key={si}
                                  className="subitem-chip"
                                  onClick={() => setForm({ goalId: g.id, stepIndex: i, subIndex: si, mode: 'journal', text: '' })}
                                >
                                  {sub.name}
                                </button>
                              )
                            })}
                            {!subsAllDone && (
                              <button
                                className="subitem-chip quick"
                                onClick={() => setForm({ goalId: g.id, stepIndex: i, subIndex: null, mode: 'journal', text: '' })}
                              >
                                ✍️ 随手记（AI 帮你分）
                              </button>
                            )}
                            {subDoneCount > 0 && !subsAllDone && (
                              <span className="muted" style={{ fontSize: 11 }}>
                                今日 {subDoneCount}/{subs.length}
                              </span>
                            )}
                          </div>
                        )}

                        {log && (
                          <div className="step-log">
                            ✓ 今日已{isJournal ? '记录' : '完成'}：{log.text || '完成'}
                          </div>
                        )}
                        {open && (
                          <div className="record-form">
                            {form.subIndex == null && (s.options || []).length > 0 && (
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
                              placeholder={
                                form.mode === 'note'
                                  ? '补一句备注（可选）'
                                  : form.subIndex != null
                                    ? `写一写${(subs[form.subIndex] || {}).name || ''}的内容`
                                    : subs.length > 0
                                      ? '把今天吃的/做的都写下来，AI 帮你分到各项（也可只写一项）'
                                      : isJournal
                                        ? '写一写今天的数据（吃了什么/称了多少…或点上面选项）'
                                        : '备注（可选）'
                              }
                              maxLength={300}
                            />
                            <div className="row" style={{ marginTop: 8, gap: 8 }}>
                              <button
                                className="btn btn-primary"
                                onClick={() =>
                                  act(
                                    {
                                      action: form.mode === 'note' ? 'stepNote' : 'stepRecord',
                                      goalId: g.id,
                                      stepIndex: i,
                                      subIndex: form.subIndex,
                                      text: form.text,
                                    },
                                    form.mode === 'note'
                                      ? '备注已保存'
                                      : form.subIndex != null
                                        ? `已记录${(subs[form.subIndex] || {}).name || ''} ✓`
                                        : subs.length > 0
                                          ? '已记录 ✓'
                                          : isJournal
                                            ? '已记录 ✓'
                                            : '已完成 ✓'
                                  )
                                }
                              >
                                {form.mode === 'note' ? '保存备注' : form.subIndex != null ? '提交' : subs.length > 0 ? '提交（AI 梳理）' : isJournal ? '提交记录' : '完成'}
                              </button>
                              <button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {g.status === 'active' && s.status === 'todo' && !open && (
                        <div className="step-actions">
                          {log ? (
                            <button className="login-skip" onClick={() => setForm({ goalId: g.id, stepIndex: i, subIndex: null, mode: 'note', text: log.text || '' })}>
                              ✏️ 备注
                            </button>
                          ) : subs.length === 0 ? (
                            isJournal ? (
                              <button className="btn btn-primary btn-sm" onClick={() => setForm({ goalId: g.id, stepIndex: i, subIndex: null, mode: 'journal', text: '' })}>
                                ✍️ 写一写
                              </button>
                            ) : (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => act({ action: 'stepRecord', goalId: g.id, stepIndex: i, subIndex: null, text: '' }, '已完成 ✓')}
                              >
                                ✓ 完成
                              </button>
                            )
                          ) : null}
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
