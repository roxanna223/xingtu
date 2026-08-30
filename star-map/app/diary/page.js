'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import { fmtKey, todayKey, parseKey, fmtDate, dayKeyOfIso } from '@/lib/day'
import { nextQuestion } from '@/lib/guideQuestions'
import { EMO_COLORS } from '@/lib/colors'

const EMOTIONS = ['焦虑', '疲惫', '迷茫', '愤怒', '平静', '期待', '低落', '充实']
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default function DiaryPage() {
  const [day, setDay] = useState('') // 当前查看/编辑的日期（6:00 划日）
  const [content, setContent] = useState('')
  const [mood, setMood] = useState([])
  const [question, setQuestion] = useState(null)
  const [qHidden, setQHidden] = useState(false)
  const [quick, setQuick] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [toast, setToast] = useState('')
  const [cal, setCal] = useState(null) // { month, days: [{date, mood}] }
  const recRef = useRef(null)
  const saveTimer = useRef(null)
  const contentRef = useRef('')
  const moodRef = useRef([])
  const dayRef = useRef('')
  contentRef.current = content
  moodRef.current = mood
  dayRef.current = day

  const isToday = day === todayKey()

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  function loadDay(date) {
    fetch(`/api/diary?date=${date}`).then((r) => r.json()).then((d) => {
      setDay(d.date)
      setContent(d.content)
      setMood(d.mood || [])
      setQuestion(d.question)
      setQHidden(false)
      setSaved(false)
      loadMonth(d.date.slice(0, 7))
    })
  }

  function loadMonth(ym) {
    fetch(`/api/diary?month=${ym}`).then((r) => r.json()).then((d) => setCal(d))
  }

  useEffect(() => {
    fetch('/api/diary').then((r) => r.json()).then((d) => {
      setDay(d.date)
      setContent(d.content)
      setMood(d.mood || [])
      setQuestion(d.question)
      loadMonth(d.date.slice(0, 7))
    })
  }, [])

  // 自动保存（防抖 1.5s）；空内容空情绪不写
  async function persist(nextContent, nextMood, targetDay) {
    const d = targetDay || dayRef.current
    if (!d) return
    if (!String(nextContent || '').trim() && !(nextMood || []).length) {
      setSaved(false)
      return
    }
    setBusy(true)
    try {
      const r = await fetch('/api/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: d, content: nextContent, mood: nextMood }),
      })
      const data = await r.json()
      if (!data.ok) {
        showToast(data.error || '保存失败')
        return
      }
      setSaved(true)
      loadMonth(d.slice(0, 7))
    } catch {
      showToast('保存失败，请检查网络')
    } finally {
      setBusy(false)
    }
  }

  function onChange(text) {
    setContent(text)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(text, moodRef.current, dayRef.current), 1500)
  }

  function toggleMood(em) {
    const next = mood.includes(em) ? mood.filter((m) => m !== em) : [...mood, em]
    setMood(next)
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(contentRef.current, next, dayRef.current), 800)
  }

  function addQuickLine(e) {
    e?.preventDefault()
    const t = quick.trim()
    if (!t) return
    const next = content ? `${content.replace(/\s+$/, '')}\n- ${t}` : `- ${t}`
    setQuick('')
    onChange(next)
  }

  function changeQuestion() {
    setQuestion((cur) => nextQuestion(cur, 0))
  }

  function shiftDay(n) {
    const d = parseKey(day)
    d.setDate(d.getDate() + n)
    const target = fmtDate(d)
    const tk = todayKey()
    if (target > tk) {
      showToast('还没到那天，先写今天吧')
      return
    }
    loadDay(target)
  }

  async function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      showToast('当前浏览器不支持语音输入，请用 Chrome 或 Edge 打开')
      return
    }
    if (micOn) {
      recRef.current?.stop()
      setMicOn(false)
      return
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
      } catch (e) {
        showToast(
          e.name === 'NotAllowedError'
            ? '麦克风权限被拒绝：点浏览器地址栏的锁图标允许后重试'
            : e.name === 'NotFoundError'
              ? '没有检测到麦克风设备，可先用文字输入'
              : `麦克风不可用（${e.name}）`
        )
        return
      }
    }
    const rec = new SR()
    rec.lang = 'zh-CN'
    rec.interimResults = false
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript
      setQuick((s) => (s ? s + ' ' : '') + t)
    }
    rec.onerror = (e) => {
      setMicOn(false)
      showToast(`语音输入失败（${e.error || '未知原因'}）`)
    }
    rec.onend = () => setMicOn(false)
    recRef.current = rec
    try {
      rec.start()
      setMicOn(true)
    } catch {
      setMicOn(false)
      showToast('语音输入启动失败，可先用文字输入')
    }
  }

  // 月历网格：周日对齐（周一起始）
  function buildGrid() {
    if (!cal) return null
    const [y, m] = cal.month.split('-').map(Number)
    const first = new Date(y, m - 1, 1)
    const cells = []
    const lead = (first.getDay() + 6) % 7 // 周一=0
    for (let i = 0; i < lead; i++) cells.push(null)
    const daysInMonth = new Date(y, m, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${cal.month}-${String(d).padStart(2, '0')}`)
    return cells
  }

  const grid = buildGrid()
  const moodMap = {}
  for (const d of cal?.days || []) moodMap[d.date] = d.mood

  return (
    <div className="page">
      <div className="page-head">
        <h1>日记</h1>
        <span className="sub">今天的归档 · 写多少都行，不写也没关系</span>
      </div>
      <NavBar />

      <div className="row" style={{ marginBottom: 12, alignItems: 'center', gap: 8 }}>
        <button className="btn btn-ghost" onClick={() => shiftDay(-1)}>◀ 前一天</button>
        <span className="pill">📅 {day ? fmtKey(day) : '…'}{!isToday && day ? '（补写）' : ''}</span>
        {!isToday && <button className="btn btn-ghost" onClick={() => loadDay(todayKey())}>回到今天</button>}
        {!isToday && <button className="btn btn-ghost" onClick={() => shiftDay(1)}>后一天 ▶</button>}
        <span style={{ flex: 1 }} />
        <span className={busy ? 'pill' : saved ? 'pill ok' : 'pill'}>
          {busy ? '保存中…' : saved ? '已保存 ✓' : '尚未保存'}
        </span>
        <Link href="/chat" className="pill" style={{ textDecoration: 'none' }}>
          💬 想聊着记？去和小星聊聊
        </Link>
      </div>

      {cal && (
        <div className="card" style={{ marginBottom: 14, padding: '12px 14px' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>{cal.month.replace('-', ' 年 ')} 月</b>
            <span className="muted" style={{ fontSize: 11 }}>点日期回看/补写 · 圆点 = 当天心情</span>
          </div>
          <div className="cal-grid">
            {WEEK.map((w) => (
              <div key={w} className="cal-cell cal-head">{w}</div>
            ))}
            {grid.map((date, i) =>
              date === null ? (
                <div key={`e${i}`} className="cal-cell cal-empty" />
              ) : (
                <button
                  key={date}
                  className={`cal-cell ${date === day ? 'on' : ''} ${date === todayKey() ? 'today' : ''}`}
                  onClick={() => loadDay(date)}
                >
                  <span className="cal-num">{Number(date.slice(-2))}</span>
                  <span className="cal-dots">
                    {(moodMap[date] || []).slice(0, 3).map((em, j) => (
                      <i key={j} style={{ background: EMO_COLORS[em] || '#888' }} />
                    ))}
                  </span>
                </button>
              )
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>这一天的心情：</span>
          {EMOTIONS.map((em) => (
            <span key={em} className={mood.includes(em) ? 'chip on' : 'chip'} onClick={() => toggleMood(em)}>
              {em}
            </span>
          ))}
        </div>
      </div>

      {!qHidden && question && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(245,199,106,0.35)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>今日一问 · 想答就写进日记里</span>
            <div>
              <button className="login-skip" onClick={changeQuestion}>换一换</button>
              <button className="login-skip" onClick={() => setQHidden(true)}>跳过</button>
            </div>
          </div>
          <p style={{ fontSize: 16, lineHeight: 1.8, margin: '10px 0 0' }}>{question.q}</p>
        </div>
      )}

      <form className="card chat-input-row" onSubmit={addQuickLine} style={{ marginBottom: 14, padding: '10px 12px' }}>
        <button type="button" className={`btn ${micOn ? 'btn-primary' : 'btn-ghost'}`} onClick={toggleMic} title="语音输入">
          {micOn ? '⏹' : '🎤'}
        </button>
        <input
          type="text"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="一句话起笔：此刻最想记下的事…（回车写入）"
        />
        <button className="btn btn-primary" disabled={!quick.trim()}>写入</button>
      </form>

      <div className="card">
        <textarea
          className="diary-editor"
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'自由书写，像给自己写文档一样。\n\n不想写就留白——点过心情也算记了一笔。'}
          rows={14}
        />
        <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            内容会自动保存 · 每天 6:00 小星会把这一天（含这里）归纳进日报
          </span>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => persist(contentRef.current, moodRef.current, dayRef.current)}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
