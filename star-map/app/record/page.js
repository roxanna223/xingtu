'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import EmotionTrack from '@/components/EmotionTrack'

const STAGES = ['在校', '实习', '工作1-3年', '工作3年以上', '自由职业', '待业']

function speak(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    u.rate = 1
    window.speechSynthesis.speak(u)
  } catch {}
}

// 心情轨迹（对象数组）序列化为文本，供后端抽取与"今日心情色"统计
function trackToText(items) {
  return (items || [])
    .map((it) => (it.event ? `${it.event}（${(it.emotions || []).join('、')}）` : (it.emotions || []).join('、')))
    .join('、')
}

export default function RecordPage() {
  const [status, setStatus] = useState(null)
  const [tab, setTab] = useState('chat')

  // 对话模式
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [speakingIdx, setSpeakingIdx] = useState(-1)
  const recRef = useRef(null)
  const autoSpeakRef = useRef(false)
  autoSpeakRef.current = autoSpeak

  // 快速记录模式
  const [onboard, setOnboard] = useState({ birthYearMonth: '', careerStage: '', worries: ['', '', ''] })
  const [rec, setRec] = useState({ date: new Date().toISOString().slice(0, 10), freeText: '', q1: '', q2: [], q3: '' })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const chatEndRef = useRef(null)

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then(setStatus)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  /* ---------- 对话模式 ---------- */

  async function chat(messagesToSend, draftToSend) {
    setChatBusy(true)
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSend, draft: draftToSend }),
      })
      const data = await r.json()
      if (data.reply) {
        setMessages((m) => [...m, { role: 'assistant', content: data.reply }])
        if (autoSpeakRef.current) {
          const idx = messagesToSend.length + 1
          setSpeakingIdx(idx)
          speak(data.reply)
        }
      }
      if (data.draft) setDraft(data.draft)
      return data
    } finally {
      setChatBusy(false)
    }
  }

  useEffect(() => {
    if (tab === 'chat' && messages.length === 0 && status) {
      chat([], null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status])

  async function sendMessage(e) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || chatBusy) return
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    await chat(next, draft)
  }

  async function askSummarize() {
    if (chatBusy || !messages.some((m) => m.role === 'user')) return
    const next = [...messages, { role: 'user', content: '[帮我梳理今天]' }]
    setMessages(next)
    await chat(next, draft)
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
    // 先预检麦克风权限，给出明确失败原因
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

  function toggleSpeak(idx, text) {
    if (speakingIdx === idx) {
      window.speechSynthesis?.cancel()
      setSpeakingIdx(-1)
    } else {
      setSpeakingIdx(idx)
      speak(text)
    }
  }

  async function saveNow() {
    if (!messages.some((m) => m.role === 'user')) {
      showToast('先聊两句再保存吧')
      return
    }
    setChatBusy(true)
    const transcript = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    const r = await fetch('/api/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        freeText: transcript,
        q1: draft?.q1 || '',
        q2: trackToText(draft?.q2),
        q3: draft?.q3 || '',
      }),
    })
    const data = await r.json()
    setChatBusy(false)
    if (data.ok) {
      setSaved(true)
      setDraft(null)
      showToast('今日星图已保存')
      fetch('/api/status').then((r) => r.json()).then(setStatus)
    } else {
      showToast(data.error || '保存失败')
    }
  }

  /* ---------- 快速记录模式 ---------- */

  async function doOnboard(e) {
    e.preventDefault()
    setBusy(true)
    const r = await fetch('/api/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(onboard),
    })
    await r.json()
    setBusy(false)
    showToast('已记下，开始今天的记录吧')
    fetch('/api/status').then((r) => r.json()).then(setStatus)
  }

  async function doRecord(e) {
    e.preventDefault()
    if (!rec.freeText.trim()) {
      showToast('先随便写几句吧，说得越乱越好')
      return
    }
    setBusy(true)
    const r = await fetch('/api/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rec, q2: trackToText(rec.q2) }),
    })
    const data = await r.json()
    setBusy(false)
    if (data.ok) {
      showToast('记录完成，去看看你的星图吧')
      setRec({ date: new Date().toISOString().slice(0, 10), freeText: '', q1: '', q2: [], q3: '' })
      fetch('/api/status').then((r) => r.json()).then(setStatus)
    } else {
      showToast(data.error || '提交失败')
    }
  }

  const onboarded = status?.onboarded

  return (
    <div className="page">
      <div className="page-head">
        <h1>记录星图</h1>
        <span className="sub">把今天理清楚，落进你的星图</span>
      </div>
      <NavBar />

      <div className="row" style={{ marginBottom: 16 }}>
        <span className="pill">已记录 {status?.dayCount ?? 0} 天</span>
        <span className={status?.hasKey ? 'pill' : 'pill warn'}>
          {status?.hasKey ? '在线引擎' : 'Mock 引擎（未配置 API Key）'}
        </span>
      </div>

      {!onboarded && (
        <form className="card" onSubmit={doOnboard}>
          <h2>开始之前，让我先了解你</h2>
          <p className="muted" style={{ marginTop: 0 }}>这些信息不会被展示，只用于我更准确地理解你。</p>
          <div className="field">
            <label>出生年月</label>
            <input type="month" value={onboard.birthYearMonth} onChange={(e) => setOnboard({ ...onboard, birthYearMonth: e.target.value })} required />
          </div>
          <div className="field">
            <label>当前职业阶段</label>
            <select value={onboard.careerStage} onChange={(e) => setOnboard({ ...onboard, careerStage: e.target.value })} required>
              <option value="">请选择</option>
              {STAGES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>
          <div className="field">
            <label>当前最纠结的三件事（各一句话）</label>
            {onboard.worries.map((w, i) => (
              <input key={i} type="text" placeholder={`第 ${i + 1} 件`} value={w}
                onChange={(e) => { const next = [...onboard.worries]; next[i] = e.target.value; setOnboard({ ...onboard, worries: next }) }}
                style={{ marginBottom: 8 }} />
            ))}
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? '记录中…' : '完成'}</button>
        </form>
      )}

      <div className="chips" style={{ marginBottom: 16 }}>
        <span className={tab === 'chat' ? 'chip on' : 'chip'} onClick={() => setTab('chat')}>和星图聊聊</span>
        <span className={tab === 'form' ? 'chip on' : 'chip'} onClick={() => setTab('form')}>快速记录</span>
      </div>

      {tab === 'chat' && (
        <div className="card chat-panel">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span className="muted">说几句就能保存，不梳理也可以；想整理就点"帮我梳理"。</span>
            <span className={autoSpeak ? 'chip on' : 'chip'} onClick={() => setAutoSpeak((v) => !v)}>
              🔊 自动朗读
            </span>
          </div>

          {saved ? (
            <div className="empty-state">
              今天的星图已保存 ✅<br />
              <Link href="/report" className="muted" style={{ fontSize: 15, color: '#f5c76a' }}>立即查看今日报告 →</Link>
              <br />
              <Link href="/star-map" className="muted">去看看星图 →</Link>
              <br /><br />
              <button className="btn btn-ghost" onClick={() => { setSaved(false); setMessages([]); chat([], null) }}>再聊一会儿</button>
            </div>
          ) : (
            <>
              <div className="chat-scroll">
                {messages.map((m, i) => (
                  <div key={i} className="bubble-row">
                    <div className={`bubble ${m.role === 'user' ? 'user' : 'ai'}`}>{m.content}</div>
                    {m.role === 'assistant' && (
                      <button
                        className="speak-btn"
                        onClick={() => toggleSpeak(i, m.content)}
                        title="朗读这条"
                      >
                        {speakingIdx === i ? '⏹' : '🔊'}
                      </button>
                    )}
                  </div>
                ))}
                {chatBusy && <div className="bubble ai">…</div>}
                <div ref={chatEndRef} />
              </div>

              {draft && (
                <div className="draft-card">
                  <h3>今日梳理（可直接改，或继续聊着改）</h3>
                  <div className="field">
                    <label>今天最耗能的一件事</label>
                    <input type="text" value={draft.q1} onChange={(e) => setDraft({ ...draft, q1: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>今天的心情轨迹（可多条，每条对应一件事）</label>
                    <EmotionTrack items={draft.q2 || []} onChange={(q2) => setDraft({ ...draft, q2 })} />
                  </div>
                  <div className="field">
                    <label>明天最在意的一件事</label>
                    <input type="text" value={draft.q3} onChange={(e) => setDraft({ ...draft, q3: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>今日梳理（一两句话）</label>
                    <textarea rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
                  </div>
                  <div className="row">
                    <button className="btn btn-primary" disabled={chatBusy} onClick={saveNow}>确认保存今日星图</button>
                    <span className="muted" style={{ alignSelf: 'center' }}>或直接在下面接着聊，告诉我要怎么改</span>
                  </div>
                </div>
              )}

              <form className="chat-input-row" onSubmit={sendMessage}>
                <button type="button" className={`btn ${micOn ? 'btn-primary' : 'btn-ghost'}`} onClick={toggleMic} title="语音输入">
                  {micOn ? '⏹' : '🎤'}
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={draft ? '告诉我要怎么调整，或直接说新的想法…' : '说说今天吧，一句一句说就行…'}
                  disabled={chatBusy}
                />
                <button className="btn btn-primary" disabled={chatBusy || !input.trim()}>发送</button>
              </form>
              <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end', gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  onClick={saveNow}
                  disabled={chatBusy || !messages.some((m) => m.role === 'user')}
                >
                  💾 直接保存
                </button>
                <button className="btn btn-ghost" onClick={askSummarize} disabled={chatBusy || !messages.some((m) => m.role === 'user')}>
                  ✨ 帮我梳理今天
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'form' && (
        <form className="card" onSubmit={doRecord}>
          <h2>快速记录</h2>
          {status?.lastDate && <p className="muted" style={{ marginTop: 0 }}>上次记录：{status.lastDate}。说说今天吧。</p>}
          <div className="field">
            <label>日期（补录可改）</label>
            <input type="date" value={rec.date} onChange={(e) => setRec({ ...rec, date: e.target.value })} required />
          </div>
          <div className="field">
            <label>自由倾诉（随便写，说乱没关系——我来帮你理顺）</label>
            <textarea placeholder="今天最累的那一刻是什么？发生了什么事，你当时在想什么……" value={rec.freeText} onChange={(e) => setRec({ ...rec, freeText: e.target.value })} />
          </div>
          <div className="field">
            <label>Q1 今天最耗能的一件事</label>
            <input type="text" value={rec.q1} onChange={(e) => setRec({ ...rec, q1: e.target.value })} />
          </div>
          <div className="field">
            <label>今天的心情轨迹（可多条，每条对应一件事）</label>
            <EmotionTrack items={rec.q2} onChange={(q2) => setRec({ ...rec, q2 })} />
          </div>
          <div className="field">
            <label>Q3 明天最在意的一件事</label>
            <input type="text" value={rec.q3} onChange={(e) => setRec({ ...rec, q3: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? '正在为你梳理…' : '记录今天'}</button>
        </form>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
