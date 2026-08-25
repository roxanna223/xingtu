'use client'

import { useState } from 'react'
import DateWheel from '@/components/DateWheel'

// 客户端星座预览（与 lib/cohort.js 同表）
const SIGN_TABLE = [
  { name: '摩羯', symbol: '♑', from: [12, 22], to: [1, 19] },
  { name: '水瓶', symbol: '♒', from: [1, 20], to: [2, 18] },
  { name: '双鱼', symbol: '♓', from: [2, 19], to: [3, 20] },
  { name: '白羊', symbol: '♈', from: [3, 21], to: [4, 19] },
  { name: '金牛', symbol: '♉', from: [4, 20], to: [5, 20] },
  { name: '双子', symbol: '♊', from: [5, 21], to: [6, 21] },
  { name: '巨蟹', symbol: '♋', from: [6, 22], to: [7, 22] },
  { name: '狮子', symbol: '♌', from: [7, 23], to: [8, 22] },
  { name: '处女', symbol: '♍', from: [8, 23], to: [9, 22] },
  { name: '天秤', symbol: '♎', from: [9, 23], to: [10, 23] },
  { name: '天蝎', symbol: '♏', from: [10, 24], to: [11, 22] },
  { name: '射手', symbol: '♐', from: [11, 23], to: [12, 21] },
]

function signOf(birthDate) {
  const m = String(birthDate || '').match(/(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  const inRange = (s) => {
    if (s.from[0] === 12 && s.to[0] === 1) {
      return (month === 12 && day >= s.from[1]) || (month === 1 && day <= s.to[1])
    }
    return (month === s.from[0] && day >= s.from[1]) || (month === s.to[0] && day <= s.to[1])
  }
  return SIGN_TABLE.find(inRange) || null
}

export default function LoginPage() {
  const [mode, setMode] = useState('register')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [wheelOpen, setWheelOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const sign = signOf(birthDate)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: mode, username, password, inviteCode, birthDate }),
    })
    const data = await r.json()
    setBusy(false)
    if (data.ok) {
      window.location.href = '/'
    } else {
      setError(data.error || '操作失败')
    }
  }

  return (
    <div className="login-wrap">
      <div className="page login-page" style={{ maxWidth: 480 }}>
        <div className="login-hero">
          <div className="flag">STAR MAP · v0.1</div>
          <h1>星图</h1>
          <p className="muted">长期对话 · 内心星图 · 状态导航</p>
        </div>

        <div className="card login-card">
          <div className="sec-title" style={{ marginTop: 0 }}>— PLAYER LOGIN —</div>
          <div className="login-tabs">
            <button type="button" className={mode === 'register' ? 'login-tab on' : 'login-tab'} onClick={() => { setMode('register'); setError('') }}>
              注册
            </button>
            <button type="button" className={mode === 'login' ? 'login-tab on' : 'login-tab'} onClick={() => { setMode('login'); setError('') }}>
              登录
            </button>
          </div>

          <form onSubmit={submit}>
            <div className="field">
              <label>昵称</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="怎么称呼你？" autoFocus required minLength={2} maxLength={20} />
            </div>
            <div className="field">
              <label>密码</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? '至少 8 位，只保存在你的星图里' : '输入密码'} required minLength={mode === 'register' ? 8 : 1} />
            </div>

            {mode === 'register' && (
              <div className="field">
                <label>邀请码</label>
                <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="邀请制注册，向管理员索取邀请码" required maxLength={16} style={{ textTransform: 'uppercase' }} />
              </div>
            )}

            {mode === 'register' && (
              <div className="field">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ marginBottom: 0 }}>出生日期 · 决定星座起点（选填）</label>
                  {wheelOpen ? (
                    <button type="button" className="login-skip" onClick={() => { setWheelOpen(false); setBirthDate('') }}>
                      先不填，从星海某处开始
                    </button>
                  ) : (
                    <button type="button" className="login-skip" onClick={() => setWheelOpen(true)}>
                      补填出生日期
                    </button>
                  )}
                </div>

                {wheelOpen && (
                  <div className="wheel-panel">
                    <DateWheel onPick={setBirthDate} />
                    {sign ? (
                      <div className="sign-preview">
                        <span className="sign-preview-symbol">{sign.symbol}</span>
                        <div>
                          <div style={{ color: 'var(--yellow)', fontWeight: 800, letterSpacing: 2 }}>{sign.name}座</div>
                          <div className="muted" style={{ fontSize: 11 }}>你的星图将从这里开始</div>
                        </div>
                      </div>
                    ) : (
                      <p className="muted" style={{ margin: '10px 0 0', fontSize: 11, textAlign: 'center' }}>
                        上下滑动选择年月日，你的星座会自动出现
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {error && <p style={{ color: 'var(--red)', fontSize: 12, letterSpacing: 1 }}>⚠ {error}</p>}

            <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} disabled={busy}>
              {busy ? '正在进入…' : mode === 'register' ? '▶ 注册并进入星图' : '▶ 登录'}
            </button>
          </form>
        </div>

        <p className="muted" style={{ textAlign: 'center', marginTop: 24, fontSize: 11, lineHeight: 2.1 }}>
          换账号登录将重置全部画像数据<br />
          未配置 API Key 时自动使用 Mock 引擎，整条链路仍可跑通
        </p>
      </div>
    </div>
  )
}
