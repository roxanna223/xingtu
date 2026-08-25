'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'

export default function StarChatPage() {
  const [messages, setMessages] = useState([])
  const [quiz, setQuiz] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [sBusy, setSBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [micOn, setMicOn] = useState(false)
  const recRef = useRef(null)
  const endRef = useRef(null)
  const sessionRef = useRef(null) // 服务端持久化会话，刷新可恢复

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function fetchSuggestions() {
    setSBusy(true)
    try {
      const r = await fetch('/api/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'suggestions', messages: [], quiz: null }),
      })
      const d = await r.json()
      setSuggestions(d.suggestions || [])
    } catch {
      setSuggestions([])
    }
    setSBusy(false)
  }

  async function restoreChat() {
    try {
      const r = await fetch('/api/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'restore' }),
      })
      const d = await r.json()
      if (d.history && d.history.length) {
        sessionRef.current = d.sessionId
        setMessages(
          d.history.map((m) => ({ role: m.role, content: m.content, quiz: m.quiz || null, result: m.result || null }))
        )
        const lastQuiz = [...d.history].reverse().find((m) => m.quiz)?.quiz || null
        setQuiz(lastQuiz)
      }
    } catch {
      /* 恢复失败不阻塞 */
    }
  }

  useEffect(() => {
    fetchSuggestions()
    restoreChat()
  }, [])

  async function send(text) {
    if (!text || !text.trim() || busy) return
    setMessages((m) => [...m, { role: 'user', content: text.trim() }])
    setInput('')
    setBusy(true)
    try {
      const r = await fetch('/api/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'chat', message: text.trim(), quiz, sessionId: sessionRef.current }),
      })
      const d = await r.json()
      if (d.sessionId) sessionRef.current = d.sessionId
      if (d.reply) {
        setMessages((m) => [...m, { role: 'assistant', content: d.reply, quiz: d.quiz || null, result: d.result || null }])
      }
      setQuiz(d.quiz || null)
      if (d.result) showToast('已存入测试报告 📋')
    } catch {
      showToast('小星走神了，再试一次')
    }
    setBusy(false)
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
        setMicOn(false)
        showToast(
          e.name === 'NotAllowedError'
            ? '麦克风权限被拒绝：点浏览器地址栏的锁/摄像头图标允许麦克风后重试'
            : e.name === 'NotFoundError'
              ? '没有检测到麦克风设备，可先用文字输入'
              : `麦克风不可用（${e.name}），可先用文字输入`
        )
        return
      }
    }
    const rec = new SR()
    rec.lang = 'zh-CN'
    rec.interimResults = false
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript
      setInput((s) => (s ? s + ' ' : '') + t)
    }
    rec.onerror = (e) => {
      setMicOn(false)
      showToast(`语音输入失败（${e.error || '未知原因'}），可先用文字输入`)
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

  return (
    <div className="page">
      <div className="page-head">
        <h1>小星</h1>
        <span className="sub">
          基于你的星图，陪你聊、陪你测
          <Link href="/tests" className="muted" style={{ marginLeft: 12, textDecoration: 'none' }}>📋 测试报告</Link>
        </span>
      </div>
      <NavBar />

      <div className="card chat-panel">
        <div className="chat-scroll">
          {messages.length === 0 && (
            <div className="star-intro">
              <div className="star-avatar">⭐</div>
              <p>我是小星。想聊什么，你开口；不想想话题，就点下面一张。</p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className="bubble-col">
              <div className={`bubble ${m.role === 'user' ? 'user' : 'ai'}`}>{m.content}</div>

              {m.quiz && (
                <div className="quiz-card">
                  <div className="quiz-title">
                    {m.quiz.emoji} {m.quiz.title} · 第 {m.quiz.index}/{m.quiz.total} 题
                  </div>
                  <div className="quiz-question">{m.quiz.question}</div>
                  <div className="quiz-options">
                    {m.quiz.options.map((opt) => (
                      <button key={opt} className="quiz-opt" disabled={busy || quiz?.index !== m.quiz.index} onClick={() => send(`我选：${opt}`)}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {m.result && (
                <div className="result-card">
                  <div className="result-emoji">{m.result.emoji}</div>
                  <div className="result-title">{m.result.title}</div>
                  <div className="result-headline">“{m.result.headline}”</div>
                  <p className="result-content">{m.result.content}</p>
                  <div className="muted" style={{ fontSize: 12 }}>已存入测试报告 📋</div>
                </div>
              )}
            </div>
          ))}

          {busy && <div className="bubble ai">…</div>}
          <div ref={endRef} />
        </div>

        {messages.length === 0 && !quiz && (
          <div className="suggest-block">
            <div className="suggest-head">
              <span className="muted">不知道聊什么？试试：</span>
              <button className="login-skip" onClick={fetchSuggestions} disabled={sBusy}>
                {sBusy ? '生成中…' : '换一换'}
              </button>
            </div>
            <div className="suggest-grid">
              {suggestions.map((s) => (
                <button key={s} className="suggest-card" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <form className="chat-input-row" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          <button type="button" className={`btn ${micOn ? 'btn-primary' : 'btn-ghost'}`} onClick={toggleMic} title="语音输入">
            {micOn ? '⏹' : '🎤'}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={quiz ? '点击上面的选项作答' : '和小星说点什么…'}
            disabled={busy}
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()}>发送</button>
        </form>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
