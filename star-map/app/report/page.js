'use client'

import { useEffect, useState } from 'react'
import NavBar from '@/components/NavBar'
import MoodCard from '@/components/MoodCard'

const RANGE_LABELS = { week: '周报', month: '月报', quarter: '季报', year: '年报' }

export default function ReportPage() {
  const [report, setReport] = useState(null)
  const [tier, setTier] = useState('')
  const [date, setDate] = useState('')
  const [range, setRange] = useState('day')
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [history, setHistory] = useState([])
  const [helpful, setHelpful] = useState(null)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const [obsVoted, setObsVoted] = useState({})
  const [toast, setToast] = useState('')
  const [adoption, setAdoption] = useState(null) // 本报告建议的采纳标记（已存证）
  const [adopting, setAdopting] = useState(false)

  useEffect(() => {
    fetch('/api/reports').then((r) => r.json()).then((d) => setHistory(d.reports || []))
  }, [])

  function load(t, d, r = range, force = false) {
    setPhase('loading')
    const qs = new URLSearchParams()
    if (t) qs.set('tier', t)
    if (r !== 'day') qs.set('range', r)
    else if (d) qs.set('date', d)
    if (force) qs.set('refresh', '1')
    fetch(`/api/report${qs.toString() ? `?${qs.toString()}` : ''}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        setReport(data)
        setAdoption(data.adoption || null)
        setPhase('ready')
        // 旧版"生成中"轮询已废弃：今天的日报等到明天 6:00（pending），无需轮询
      })
      .catch(() => setPhase('error'))
  }

  useEffect(() => {
    // 支持 /report?range=week 直达周期报告（主页「本周回顾」入口）
    const q = new URLSearchParams(window.location.search)
    const r = q.get('range')
    if (r && RANGE_LABELS[r]) {
      setRange(r)
      load('', '', r)
    } else {
      load('', '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function switchRange(r) {
    setRange(r)
    setDate('')
    setObsVoted({})
    setAdoption(null)
    load(tier, '', r)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function sendFeedback(h) {
    setHelpful(h)
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: h, comment }),
    })
    const data = await r.json()
    setSent(true)
    // P0-2 反馈闭环感知：明确告诉用户这条反馈会改变什么
    showToast(
      data.adjusted?.length
        ? `已记住 ✓ 小星会调整对「${data.adjusted.join('、')}」的观察，明天的报告会不一样`
        : '已记住 ✓ 小星会调整明天的观察方式，报告会不一样'
    )
  }

  async function voteObs(i, ok) {
    const o = report.observations[i]
    if (!o) return
    setObsVoted((v) => ({ ...v, [i]: ok }))
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observation: o.text, ok }),
      })
      showToast(ok ? '已记下，谢谢确认' : '已记下，我会调整观察方式')
    } catch {
      showToast('反馈失败，稍后再试')
    }
  }

  async function sendAdoption(adopted) {
    setAdopting(true)
    try {
      const r = await fetch('/api/adoption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: range === 'day' ? 'day' : range, date: range === 'day' ? date : '', adopted }),
      })
      const data = await r.json()
      if (!r.ok) {
        showToast(data.error || '标记失败，稍后再试')
        return
      }
      setAdoption({ adopted: data.adopted, reportKey: data.reportKey, date: new Date().toISOString().slice(0, 10) })
      showToast(`已记下${data.topicName ? `（主题：${data.topicName}）` : ''}。下次报告会回顾这条建议的效果。`)
    } catch {
      showToast('标记失败，稍后再试')
    } finally {
      setAdopting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>星图</h1>
        <span className="sub">
          {range !== 'day'
            ? `${RANGE_LABELS[range] || ''}${report?.periodLabel ? ` · ${report.periodLabel}` : ''}${report?.start ? `（${report.start} ~ ${report.end}）` : ''}`
            : date
              ? `日报 · 截至 ${date}`
              : '状态报告'}
        </span>
      </div>
      <NavBar />

      <div className="chips" style={{ marginBottom: 16 }}>
        {[['day', '日'], ['week', '周'], ['month', '月'], ['quarter', '季'], ['year', '年']].map(([r, label]) => (
          <span key={r} className={range === r ? 'chip on' : 'chip'} onClick={() => switchRange(r)}>
            {label}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        {((range !== 'day' && !date) || (range === 'day' && date)) && (
          <button className="login-skip" onClick={() => load(tier, date, range, true)}>
            ↻ 重新生成
          </button>
        )}
      </div>

      {range === 'day' && history.length > 0 && (
        <div className="history-strip">
          <div className="history-head">
            <span className="muted" style={{ fontSize: 13 }}>报告历史 · 首次查看后已缓存，不会重复生成</span>
            {date && date !== history[history.length - 1]?.date && (
              <button className="login-skip" onClick={() => { setDate(''); load(tier, '', 'day') }}>
                回到最新
              </button>
            )}
          </div>
          <div className="history-list">
            {history.map((h) => {
              const isLatest = h.date === history[history.length - 1].date
              const isActive = isLatest ? !date : date === h.date
              return (
                <button
                  key={h.date}
                  className={isActive ? 'history-card on' : 'history-card'}
                  onClick={() => {
                    if (isLatest) {
                      setDate('')
                      load(tier, '', 'day')
                    } else {
                      setDate(h.date)
                      load(tier, h.date, 'day')
                    }
                  }}
                >
                  <span className="history-dot" style={{ background: h.moodColor }} />
                  <span className="history-date">{h.date.slice(5)}</span>
                  <span className="history-emo">{h.topEmotion || '—'}</span>
                  <span className="history-q1">{h.q1 || '（无标题）'}</span>
                  {isLatest && <span className="history-badge">最新</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {report?.crisis && (
        <div className="crisis-banner">
          你最近的状态听起来很不容易。这份报告不能替代专业帮助，如果需要，请拨打心理援助热线 12356，或联系身边的信任的人。
        </div>
      )}

      {range !== 'day' && report?.periodLabel && /^上|去/.test(report.periodLabel) && (
        <div className="card" style={{ borderColor: 'rgba(245,199,106,0.4)', padding: '10px 16px' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            💡 本周期还在进行中——先看最近的完整周期（{report.periodLabel}）。周期结束后会生成新的报告。
          </span>
        </div>
      )}

      {phase === 'loading' && (
        <div className="card empty-state">
          <div className="spinner" />
          <p className="muted" style={{ marginTop: 14 }}>正在为你生成报告…（第一次约需几秒）</p>
        </div>
      )}

      {phase === 'ready' && report?.pending && (
        <div className="card empty-state">
          <p style={{ fontSize: 14, margin: 0 }}>🌅 今天的完整日报会在<b>明天 6:00</b>生成。</p>
          {report.todaySummary ? (
            <div style={{ marginTop: 12, textAlign: 'left' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>现在的小结（随记录即时更新）：</div>
              <p style={{ margin: 0, lineHeight: 1.8 }}>{report.todaySummary}</p>
            </div>
          ) : (
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
              先写几句日记或和小星聊聊，小结会马上出现。
            </p>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="card empty-state">
          <p>报告生成失败了，稍等几秒再试试。</p>
          <button className="btn btn-primary" onClick={() => load(tier, date, range)}>重新生成</button>
        </div>
      )}

      {phase === 'ready' && report && !report.generating && !report.pending && (
        <>
          {report.dataNote && (
            <div className="card" style={{ borderColor: 'rgba(245,199,106,0.4)', padding: '12px 16px' }}>
              <span className="muted" style={{ fontSize: 13 }}>⚠️ {report.dataNote}</span>
            </div>
          )}

          <div className="card mood-card">
            <MoodCard mood={report.moodCard} note={report.moodNote} />
            <div className="mood-card-meta">
              <h2 style={{ marginBottom: 6 }}>今日心情色</h2>
              <div className="mood-name">
                {report.moodCard?.name || '雾灰'}
                {report.moodCard?.line ? <span className="mood-line"> · {report.moodCard.line}</span> : null}
              </div>
              <p className="muted" style={{ margin: '8px 0 0', lineHeight: 1.7 }}>{report.moodNote || '今天的颜色来自你的心情轨迹。'}</p>
            </div>
          </div>

          <div className="card">
            <div className="tier-toggle">
              <button className={tier !== 'result' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => { setTier(''); load('', date) }}>
                逻辑版
              </button>
              <button className={tier === 'result' ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => { setTier('result'); load('result', date) }}>
                结果版
              </button>
            </div>

            {report.trends?.length > 0 && (
              <div className="report-sec">
                <h3>这个周期的趋势</h3>
                {(report.trends || []).map((t, i) => (
                  <div key={i} className="trend-item">✦ {t}</div>
                ))}
              </div>
            )}

            {report.track?.length > 0 && (
              <div className="report-sec" style={{ borderTop: 'none', marginTop: 0 }}>
                <h3>今天的心情轨迹</h3>
                {report.track.map((t, i) => (
                  <div key={i} className="track-item" style={{ marginBottom: 6 }}>
                    <span className="track-event">{t.event}</span>
                    <span className="track-ems">{t.emotions?.length ? t.emotions.join(' · ') : ''}</span>
                  </div>
                ))}
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  主导域：<b style={{ color: 'var(--yellow)' }}>{report.dominantDomain || '—'}</b> · 活跃主题：{report.topTopics?.join('、') || '—'}
                </p>
              </div>
            )}

            <div className="report-sec">
              <h3>今日回放</h3>
              <p style={{ fontSize: 15, lineHeight: 1.9, margin: 0 }}>{report.playback || '今天还没有记录。'}</p>
            </div>

            <div className="report-sec">
              <h3>我注意到</h3>
              {(report.observations || []).length === 0 ? (
                <p className="muted">今天的记录还不够，我先不下结论。</p>
              ) : (
                (report.observations || []).map((o, i) => (
                  <div key={i} className="obs-item">
                    <div>{o.text}</div>
                    {o.quote && <div className="obs-quote">“{o.quote}”</div>}
                    {range === 'day' && !date && obsVoted[i] === undefined && (
                      <div className="obs-vote">
                        <button className="login-skip" onClick={() => voteObs(i, true)}>说得对</button>
                        <button className="login-skip" onClick={() => voteObs(i, false)}>不太对</button>
                      </div>
                    )}
                    {obsVoted[i] === true && <span className="muted" style={{ fontSize: 12 }}>已记下 ✓</span>}
                    {obsVoted[i] === false && <span className="muted" style={{ fontSize: 12 }}>已记下，会调整 ✓</span>}
                  </div>
                ))
              )}
            </div>

            {report.coordinates && (
              <div className="report-sec">
                <h3>我的坐标 · 差距 / 目标 / 自我</h3>
                <div className="coord-grid">
                  <div className="coord-item">
                    <b>📏 差距</b>
                    <p>{report.coordinates.gap || '—'}</p>
                  </div>
                  <div className="coord-item">
                    <b>🎯 目标</b>
                    <p>{report.coordinates.goal || '—'}</p>
                  </div>
                  <div className="coord-item">
                    <b>🪞 自我</b>
                    <p>{report.coordinates.self || '—'}</p>
                  </div>
                </div>
              </div>
            )}

            {(report.growthPlan || report.suggestion) && (
              <div className="report-sec">
                <h3>成长规划 · 本周一小步</h3>
                <div className="path-card">{report.growthPlan || report.suggestion}</div>
                {!adoption ? (
                  <div className="feedback-row" style={{ marginTop: 12 }}>
                    <button className="btn btn-ghost" disabled={adopting} onClick={() => sendAdoption(true)}>✅ 我做到了</button>
                    <button className="btn btn-ghost" disabled={adopting} onClick={() => sendAdoption(false)}>✗ 还没做</button>
                    <span className="muted">标记后，下次报告会回顾这条建议的效果</span>
                  </div>
                ) : (
                  <p className="muted" style={{ margin: '12px 0 0', fontSize: 13 }}>
                    已记下：这条建议你标记「{adoption.adopted ? '已做到' : '还没做'}」✓ 下次报告会一起回顾。
                  </p>
                )}
              </div>
            )}

            {report.adoptionReview && (
              <div className="report-sec">
                <h3>回看</h3>
                <p style={{ fontSize: 15, lineHeight: 1.9, margin: 0 }}>{report.adoptionReview}</p>
              </div>
            )}

            {range !== 'day' && report.adoptionNote && (
              <div className="report-sec">
                <h3>上周建议 → 本周期变化</h3>
                <div className="rcause">📌 {report.adoptionNote}</div>
              </div>
            )}

            <div className="report-sec">
              <h3>下一句</h3>
              <p className="muted" style={{ fontSize: 15 }}>{report.nextQuestion || '明天继续聊。'}</p>
            </div>

            {range === 'day' && !date && (
              <div className="report-sec">
                <h3>这份报告对你有帮助吗？</h3>
                {!sent ? (
                  <>
                    <div className="feedback-row">
                      <button className="btn btn-ghost" onClick={() => sendFeedback(true)}>有帮助</button>
                      <button className="btn btn-ghost" onClick={() => sendFeedback(false)}>没帮助</button>
                      <span className="muted">你的反馈会直接改变明天的星图</span>
                    </div>
                    {helpful !== null && (
                      <div className="field" style={{ marginTop: 12 }}>
                        <label>一句话原因（可选，写哪个主题让你有/没有收获）</label>
                        <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="例如：转行建议对我有用" />
                        <div style={{ marginTop: 10 }}>
                          <button className="btn btn-primary" onClick={() => sendFeedback(helpful)}>提交反馈</button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="muted">已收到 ✓ 这条反馈已写进你的画像，明天的报告与观察会跟着调整。</p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
