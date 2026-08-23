'use client'

import { useState } from 'react'

const EMOTIONS = ['焦虑', '疲惫', '迷茫', '愤怒', '平静', '期待', '低落', '充实']

// 心情轨迹编辑器：以事件为核心，一件事可以带多个情绪
// items: [{event: string, emotions: string[]}]
export default function EmotionTrack({ items = [], onChange }) {
  const [event, setEvent] = useState('')
  const [ems, setEms] = useState([])

  function toggleEm(em) {
    setEms((s) => (s.includes(em) ? s.filter((x) => x !== em) : [...s, em]))
  }

  function add() {
    if (!event.trim() && ems.length === 0) return
    onChange([...items, { event: event.trim(), emotions: ems }])
    setEvent('')
    setEms([])
  }

  return (
    <div>
      <div className="field" style={{ marginBottom: 8 }}>
        <input
          type="text"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
          placeholder="哪件事（一件事可以有多种心情）"
        />
      </div>
      <div className="chips" style={{ marginBottom: 8 }}>
        {EMOTIONS.map((em) => (
          <span key={em} className={ems.includes(em) ? 'chip on' : 'chip'} onClick={() => toggleEm(em)}>
            {em}
          </span>
        ))}
      </div>
      <button type="button" className="btn btn-ghost" onClick={add} disabled={!event.trim() && ems.length === 0}>
        + 添加这条
      </button>
      {items.length > 0 && (
        <div className="track-list">
          {items.map((it, i) => (
            <div key={i} className="track-item">
              <span className="track-event">{it.event || '（未命名的事）'}</span>
              <span className="track-ems">
                {it.emotions && it.emotions.length > 0 ? it.emotions.join(' · ') : '（未选心情）'}
              </span>
              <button type="button" className="track-del" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
