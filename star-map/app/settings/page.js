'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// 账号设置:账号信息 + 注销账号(方案 docs/15 §3)
export default function SettingsPage() {
  const router = useRouter()
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetch('/api/account')
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setInfo(d)
        else setError('未登录')
      })
      .catch(() => setError('加载失败'))
      .finally(() => setBusy(false))
  }, [])

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
      <div className="card" style={{ marginTop: 24 }}>
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
