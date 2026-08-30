'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'

const EMOTION_SET = new Set(['焦虑', '疲惫', '迷茫', '愤怒', '平静', '期待', '低落', '充实'])

export default function StarChatPage() {
  const [messages, setMessages] = useState([])
  const [quiz, setQuiz] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [sBusy, setSBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [guide, setGuide] = useState(false) // 记录引导模式（docs/23 §4.2）
  const [draftSaved, setDraftSaved] = useState(false) // 当前梳理卡是否已存进日记
  const recRef = useRef(null)
  const endRef = useRef(null)
  const sessionRef = useRef(null) // 服务端持久化会话，刷新可恢复
  const draftRef = useRef(null) // 最新梳理卡（随对话更新，不渲染编辑区）
  const guideRef = useRef(false)
  guideRef.current = guide

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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
          d.history.map((m) => ({ role: m.role, content: m.content, quiz: m.quiz || null, result: m.result || null, skill: m.skill || null }))
        )
        const lastQuiz = [...d.history].reverse().find((m) => m.quiz)?.quiz || null
        setQuiz(lastQuiz)
        const lastDraft = [...d.history].reverse().find((m) => m.draft)?.draft || null
        if (lastDraft) {
          draftRef.current = lastDraft
          setGuide(true)
        }
      }
    } catch {
      /* 恢复失败不阻塞 */
    }
  }

  useEffect(() => {
    fetchSuggestions()
    restoreChat()
  }, [])

  async function send(text, opts = {}) {
    if (!text || !text.trim() || busy) return
    const useGuide = opts.guide ?? guideRef.current
    if (opts.guide) setGuide(true)
    setMessages((m) => [...m, { role: 'user', content: text.trim() }])
    setInput('')
    setBusy(true)
    try {
      const r = await fetch('/api/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'chat', message: text.trim(), quiz: useGuide ? null : quiz, sessionId: sessionRef.current, guide: useGuide, draft: useGuide ? draftRef.current : null }),
      })
      const d = await r.json()
      if (d.sessionId) sessionRef.current = d.sessionId
      if (d.reply || d.skill || d.draft) {
        setMessages((m) => [...m, { role: 'assistant', content: d.reply || '', quiz: d.quiz || null, result: d.result || null, skill: d.skill || null }])
      }
      setQuiz(d.quiz || null)
      if (d.draft) {
        draftRef.current = d.draft
        setDraftSaved(false)
      }
      if (d.result) showToast('已存入测试报告 📋')
      if (d.skill) showToast('已生成目标拆解 🎯')
      if (d.goal) showToast(`目标「${d.goal.title}」已加入计划栏目 🎯`)
    } catch {
      showToast('小星走神了，再试一次')
    }
    setBusy(false)
  }

  async function askSummarize() {
    if (busy) return
    setMessages((m) => [...m, { role: 'user', content: '[帮我梳理今天]' }])
    await send('[帮我梳理今天]', { guide: true })
  }

  function exitGuide() {
    setGuide(false)
    showToast('已退出记录引导，想聊什么都可以')
  }

  // 梳理卡一键存进日记（不在聊天里编辑——想改去日记页改，日记本身就是编辑器）
  async function saveDraftToDiary() {
    const draft = draftRef.current
    if (!draft || draftSaved) return
    const emotions = [...new Set((draft.moments || []).map((m) => m.emotion).filter((e) => EMOTION_SET.has(e)))]
    const lines = [
      draft.summary || '',
      '',
      ...(draft.moments || []).map((m) => `- ${m.event || ''}${m.thought ? `（当时想：${m.thought}）` : ''}${m.emotion ? `（${m.emotion}）` : ''}`),
    ]
    if (draft.signals) lines.push('', `身体信号：${draft.signals}`)
    if (draft.unsaid) lines.push('', `没说出的话：${draft.unsaid}`)
    if (draft.tomorrow) lines.push('', `明天最在意：${draft.tomorrow}`)
    const content = lines.filter((l) => l.trim()).join('\n').trim()
    if (!content) {
      showToast('梳理卡还是空的，再聊两句吧')
      return
    }
    setBusy(true)
    try {
      const r = await fetch('/api/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mood: emotions }),
      })
      const d = await r.json()
      if (d.ok) {
        setDraftSaved(true)
        setGuide(false)
        showToast('已存进日记 📖 去日记页看看 →')
      } else {
        showToast(d.error || '保存失败')
      }
    } catch {
      showToast('保存失败，稍后再试')
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

  const hasDraft = !!draftRef.current

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

              {m.skill?.id === 'goalBreak' && (
                <div className="goal-card">
                  <div className="quiz-title">🎯 {m.skill.title}</div>
                  <p className="goal-summary">{m.skill.summary}</p>
                  {(m.skill.steps || []).slice(0, 2).map((s, i) => (
                    <div key={i} className="goal-step">
                      <span className="goal-idx">{i + 1}</span>
                      <div>
                        <div className="goal-text">{s.step}</div>
                        <div className="muted" style={{ fontSize: 12 }}>指标：{s.metric}</div>
                      </div>
                    </div>
                  ))}
                  <Link href="/goals" className="muted" style={{ display: 'inline-block', marginTop: 10, fontSize: 12 }}>
                    共 {(m.skill.steps || []).length} 步，去计划栏目查看与打卡 →
                  </Link>
                </div>
              )}
            </div>
          ))}

          {busy && <div className="bubble ai">…</div>}

          {/* 梳理卡提示：只给"存进日记"一个动作，编辑在日记页完成 */}
          {hasDraft && (
            <div className="draft-chip">
              <span>✨ 今天聊的这些，小星帮你理好了</span>
              {draftSaved ? (
                <Link href="/diary" className="login-skip">已存进日记，去改改 →</Link>
              ) : (
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={saveDraftToDiary}>📖 存进日记</button>
              )}
            </div>
          )}

          <div ref={endRef} />
        </div>

        {messages.length === 0 && !quiz && (
          <div className="suggest-block">
            <div className="suggest-head">
              <span className="muted">想聊点什么？点一张，或直接开口：</span>
              <button className="login-skip" onClick={fetchSuggestions} disabled={sBusy}>
                {sBusy ? '生成中…' : '换一换'}
              </button>
            </div>
            <div className="suggest-grid">
              {suggestions.map((s, i) => (
                <button key={i} className="suggest-card" onClick={() => send(s.text, { guide: !!s.guide })}>
                  <span className="suggest-tag">{s.tag || '轻松'}</span>
                  <b className="suggest-title">{s.title || s.text}</b>
                  <span className="suggest-text">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 功能点快捷入口（精简 3 项：对话内动作 + 高频联动；其余走底部导航） */}
        <div className="chat-toolbar">
          <button type="button" className="ct-btn" onClick={askSummarize} disabled={busy}>
            <i>✨</i>帮我梳理
          </button>
          <Link href="/diary" className="ct-btn"><i>📖</i>写日记</Link>
          <Link href="/goals" className="ct-btn"><i>🎯</i>目标</Link>
          {guide && (
            <button type="button" className="ct-btn" onClick={exitGuide}>
              <i>🚪</i>退出引导
            </button>
          )}
        </div>

        <form className="chat-input-row" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          <button type="button" className={`btn ${micOn ? 'btn-primary' : 'btn-ghost'}`} onClick={toggleMic} title="语音输入">
            {micOn ? '⏹' : '🎤'}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={quiz ? '点击上面的选项作答' : guide ? '慢慢说，我听着…' : '和小星说点什么…'}
            disabled={busy}
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()}>发送</button>
        </form>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
