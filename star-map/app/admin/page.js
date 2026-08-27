'use client'

import { useEffect, useState } from 'react'

// 管理后台(方案 docs/15 §管理员后台):仅 role=admin 可用,服务端二次鉴权
// 管理员自身操作不写入埋点(trackReq 已过滤 admin)
export default function AdminPage() {
  const [tab, setTab] = useState('stats')
  const [auth, setAuth] = useState('loading') // loading | ok | denied
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [genCount, setGenCount] = useState(1)
  const [genNote, setGenNote] = useState('')
  const [newCodes, setNewCodes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadStats() {
    const r = await fetch('/api/admin/stats')
    if (r.status === 401 || r.status === 403) { setAuth('denied'); return }
    const d = await r.json()
    setStats(d)
  }
  async function loadUsers() {
    const r = await fetch('/api/admin/users')
    const d = await r.json()
    setUsers(d.users || [])
  }
  async function loadInvites() {
    const r = await fetch('/api/admin/invites')
    const d = await r.json()
    setInvites(d.invites || [])
  }

  useEffect(() => {
    fetch('/api/admin/stats')
      .then((r) => {
        if (r.status === 401 || r.status === 403) { setAuth('denied'); return null }
        return r.json()
      })
      .then((d) => {
        if (!d) return
        setAuth('ok')
        setStats(d)
        loadUsers()
        loadInvites()
      })
      .catch(() => setAuth('denied'))
  }, [])

  async function generate(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNewCodes([])
    try {
      const r = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: genCount, note: genNote }),
      })
      const d = await r.json()
      if (d.ok) {
        setNewCodes(d.codes)
        setInvites(d.invites)
      } else {
        setError(d.error || '生成失败')
      }
    } catch {
      setError('网络错误')
    } finally {
      setBusy(false)
    }
  }

  if (auth === 'loading') return <div className="page"><div className="empty-state">正在进入星图…</div></div>
  if (auth === 'denied') {
    return <div className="page"><div className="empty-state">无管理员权限</div></div>
  }

  const ov = stats?.overview
  const daily = stats?.daily

  return (
    <div className="page admin-page" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="card" style={{ marginTop: 24 }}>
        <div className="sec-title">— ADMIN · 管理后台 —</div>
        <div className="login-tabs" style={{ marginBottom: 16 }}>
          {[
            ['stats', '📊 数据看板'],
            ['users', '👥 用户'],
            ['invites', '🎟️ 邀请码'],
          ].map(([k, label]) => (
            <button key={k} className={tab === k ? 'login-tab on' : 'login-tab'} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab === 'stats' && ov && (
          <div>
            <div className="stat-grid">
              <div className="stat-box"><b>{ov.totalUsers}</b><span>注册用户</span></div>
              <div className="stat-box"><b>{ov.users7d}</b><span>近 7 天新增</span></div>
              <div className="stat-box"><b>{ov.activeToday}</b><span>今日活跃</span></div>
              <div className="stat-box"><b>{ov.pvToday}</b><span>今日 PV</span></div>
              <div className="stat-box"><b>{ov.invites.used}/{ov.invites.total}</b><span>邀请码已用/总量</span></div>
            </div>

            <div className="sec-title" style={{ marginTop: 20 }}>近 7 天 PV 趋势</div>
            <div className="bar-row">
              {daily?.pv.map((r) => (
                <div key={r.day} className="bar-col" title={`${r.day}: ${r.n}`}>
                  <div className="bar" style={{ height: Math.max(4, Math.round((r.n / Math.max(1, ...daily.pv.map((x) => x.n))) * 80)) }} />
                  <span>{r.day.slice(5)}</span>
                </div>
              ))}
            </div>

            <div className="sec-title" style={{ marginTop: 20 }}>近 7 天活跃用户</div>
            <div className="bar-row">
              {daily?.active.map((r) => (
                <div key={r.day} className="bar-col" title={`${r.day}: ${r.n}`}>
                  <div className="bar bar-green" style={{ height: Math.max(4, Math.round((r.n / Math.max(1, ...daily.active.map((x) => x.n))) * 80)) }} />
                  <span>{r.day.slice(5)}</span>
                </div>
              ))}
            </div>

            <div className="sec-title" style={{ marginTop: 20 }}>事件分布(近 7 天)</div>
            <div className="kv-list">
              {daily?.events.map((e) => (
                <div key={e.event} className="kv"><span>{e.event}</span><b>{e.n}</b></div>
              ))}
              {(!daily?.events || daily.events.length === 0) && <p className="muted">暂无事件</p>}
            </div>

            <div className="sec-title" style={{ marginTop: 20 }}>Skill 调度统计（全量）</div>
            <div className="kv-list">
              {(stats?.skills || []).map((s) => (
                <div key={s.skillId} className="kv">
                  <span>🎯 {s.name}</span>
                  <b>触发 {s.total} · 完成 {s.completed}</b>
                </div>
              ))}
              {(!stats?.skills || stats.skills.length === 0) && <p className="muted">暂无 Skill 调度记录</p>}
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div>
            <table className="admin-table">
              <thead><tr><th>ID</th><th>昵称</th><th>角色</th><th>加入</th><th>最近活跃</th><th>记录</th><th>会话</th></tr></thead>
              <tbody>
                {(users || []).map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td><b>{u.username}</b></td>
                    <td>{u.role === 'admin' ? '管理员' : '用户'}</td>
                    <td>{(u.createdAt || '').slice(0, 10)}</td>
                    <td>{(u.lastActiveAt || '—').slice(0, 10)}</td>
                    <td>{u.dayCount}</td>
                    <td>{u.chatCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'invites' && (
          <div>
            <form onSubmit={generate} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '0 0 90px' }}>
                <label>数量</label>
                <input type="number" min={1} max={20} value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>备注(可选)</label>
                <input type="text" value={genNote} onChange={(e) => setGenNote(e.target.value)} placeholder="如:面试演示" maxLength={100} />
              </div>
              <button type="submit" className="btn" disabled={busy}>{busy ? '生成中…' : '生成邀请码'}</button>
            </form>
            {error && <p className="err">{error}</p>}
            {newCodes.length > 0 && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="sec-title">本次生成(点击复制)</div>
                <div className="code-grid">
                  {newCodes.map((c) => (
                    <button key={c} className="code-chip" onClick={() => navigator.clipboard.writeText(c)} title="点击复制">{c}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="sec-title" style={{ marginTop: 16 }}>邀请码列表(最近 200 条)</div>
            <table className="admin-table">
              <thead><tr><th>邀请码</th><th>备注</th><th>状态</th><th>使用者</th><th>创建</th><th>使用</th></tr></thead>
              <tbody>
                {(invites || []).map((iv) => (
                  <tr key={iv.code}>
                    <td><code>{iv.code}</code></td>
                    <td>{iv.note || '—'}</td>
                    <td>{iv.state === 'active' ? '✅ 可用' : iv.state === 'used' ? '已使用' : '⏰ 过期'}</td>
                    <td>{iv.usedBy || '—'}</td>
                    <td>{(iv.createdAt || '').slice(0, 10)}</td>
                    <td>{(iv.usedAt || '—').slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
