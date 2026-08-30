'use client'

import { useEffect, useState } from 'react'
import NavBar from '@/components/NavBar'

// 账号设置:账号信息 + 小星进化个人资产（查看/认可/纠正/删除/导出/重置）+ 注销账号
export default function SettingsPage() {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)

  // 进化层个人资产
  const [persona, setPersona] = useState(null)
  const [showDocs, setShowDocs] = useState(false)
  const [pBusy, setPBusy] = useState(false)

  useEffect(() => {
    fetch('/api/account')
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setInfo(d)
        else setError('未登录')
      })
      .catch(() => setError('加载失败'))
      .finally(() => setBusy(false))
    fetch('/api/persona')
      .then((r) => r.json())
      .then(setPersona)
      .catch(() => {})
  }, [])

  async function personaAction(action, id) {
    setPBusy(true)
    try {
      const r = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      const d = await r.json()
      if (d.ok) {
        setPersona((s) => ({ ...s, meta: d.meta, stats: { ...(s?.stats || {}), count: d.meta.length } }))
      } else {
        setError(d.error || '操作失败')
      }
    } catch {
      setError('网络错误，请重试')
    }
    setPBusy(false)
  }

  function exportPersona() {
    window.open('/api/persona?export=1', '_blank')
  }

  async function deleteAccount(e) {
    e.preventDefault()
    setDeleting(true)
    setError('')
    try {
      const r = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', password }),
      })
      const d = await r.json()
      if (d.ok) {
        window.location.href = '/login'
      } else {
        setError(d.error || '注销失败')
        setDeleting(false)
      }
    } catch {
      setError('网络错误，请重试')
      setDeleting(false)
    }
  }

  if (busy) return <div className="page"><div className="empty-state">正在进入星图…</div></div>

  return (
    <div className="page settings-page" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="page-head">
        <h1>设置</h1>
        <span className="sub">账号 · 小星进化 · 数据主权</span>
      </div>
      <NavBar />

      <div className="card" style={{ marginTop: 0 }}>
        <div className="sec-title">— ACCOUNT · 账号 —</div>
        {info?.user && (
          <div className="kv-list">
            <div className="kv"><span>昵称</span><b>{info.user.username}</b></div>
            <div className="kv"><span>星座</span><b>{info.user.starSign ? `${info.user.starSymbol} ${info.user.starSign}` : '未设置'}</b></div>
            <div className="kv"><span>角色</span><b>{info.user.role === 'admin' ? '管理员' : '星图旅人'}</b></div>
            <div className="kv"><span>加入时间</span><b>{(info.user.createdAt || '').slice(0, 10)}</b></div>
            <div className="kv"><span>记录天数</span><b>{info.dayCount} 天</b></div>
            <div className="kv"><span>对话会话</span><b>{info.chatCount} 个</b></div>
          </div>
        )}
        {info?.user?.role === 'admin' && (
          <div style={{ marginTop: 12 }}>
            <a className="pill" href="/admin" style={{ textDecoration: 'none', display: 'inline-block' }}>进入管理后台 →</a>
          </div>
        )}
        {error && <p className="err">{error}</p>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="sec-title">— XIAOXING EVOLUTION · 小星进化 · 个人资产 —</div>
        <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.8 }}>
          小星在和你相处中沉淀的「对你的理解」，全部属于你：可查看、认可、纠正、删除与导出。
          这些是软偏好，小星不会因此违背底线（危机转介、不评判、不诊断）。
        </p>

        {persona?.stats && (
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <span className="pill">已沉淀 {persona.stats.count} 条</span>
            <span className="pill">已确认 {persona.stats.confirmed} 条</span>
            <span className="pill">平均置信 {persona.stats.avgConf}%</span>
          </div>
        )}

        {(!persona?.meta || persona.meta.length === 0) && (
          <p className="muted">还没有沉淀出条目——多和小星聊聊、对报告点「说得对/不太对」，它就会慢慢更懂你。</p>
        )}

        {(persona?.meta || []).map((e) => (
          <div key={e.id} className="persona-item">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="tag" style={{ borderColor: 'var(--yellow)', color: 'var(--yellow)' }}>{e.domain}</span>
              <div className="row" style={{ gap: 6 }}>
                {e.trust === 'confirmed' ? (
                  <span className="muted" style={{ fontSize: 11 }}>✓ 已确认</span>
                ) : (
                  <button className="login-skip" disabled={pBusy} onClick={() => personaAction('promote', e.id)}>认可并固定</button>
                )}
                <button className="login-skip" disabled={pBusy} onClick={() => personaAction('confirm', e.id)}>✓</button>
                <button className="login-skip" disabled={pBusy} onClick={() => personaAction('correct', e.id)}>✗</button>
                <button className="login-skip" disabled={pBusy} onClick={() => personaAction('delete', e.id)}>删除</button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7 }}>
              当<b>{e.trigger}</b>时，小星会：{e.behavior}
            </div>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 11 }}>依据：{e.evidence || '—'}</span>
              <span className="conf-bar"><i style={{ width: `${Math.round(e.confidence * 100)}%` }} /></span>
              <span className="muted" style={{ fontSize: 11 }}>{Math.round(e.confidence * 100)}%</span>
            </div>
          </div>
        ))}

        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={exportPersona}>⬇ 导出我的资产</button>
          <button
            className="btn btn-ghost"
            disabled={pBusy || !persona?.meta?.length}
            onClick={() => { if (window.confirm('重置后，小星会忘掉沉淀的所有偏好（不影响日记/报告/目标）。确定吗？')) personaAction('reset') }}
          >
            重置进化层
          </button>
          <button className="btn btn-ghost" onClick={() => setShowDocs((v) => !v)}>
            {showDocs ? '收起档案' : '查看三份档案'}
          </button>
        </div>

        {showDocs && persona?.docs && (
          <div style={{ marginTop: 12 }}>
            {['self', 'persona', 'working'].map((k) => (
              <div key={k} className="persona-item">
                <b style={{ fontSize: 13 }}>{k === 'self' ? '我是谁' : k === 'persona' ? '相处方式' : '近期记忆'}</b>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7, margin: '8px 0 0', color: 'var(--fg)' }}>
                  {persona.docs[k] || '（空）'}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card danger-zone" style={{ marginTop: 16 }}>
        <div className="sec-title">— DANGER · 注销账号 —</div>
        <p className="muted">注销后你的画像、日记、对话与报告将<b>永久删除</b>，无法恢复。</p>
        {!confirmOpen ? (
          <button className="btn btn-danger" onClick={() => setConfirmOpen(true)}>我要注销账号</button>
        ) : (
          <form onSubmit={deleteAccount}>
            <div className="field">
              <label>输入密码确认注销</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="submit" className="btn btn-danger" disabled={deleting}>{deleting ? '正在注销…' : '确认永久注销'}</button>
              <button type="button" className="btn" onClick={() => { setConfirmOpen(false); setPassword(''); setError('') }}>取消</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
