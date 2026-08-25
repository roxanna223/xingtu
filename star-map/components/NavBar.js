'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// 像素顶栏（logo + 用户）+ 底部像素 tab 导航
export default function NavBar() {
  const path = usePathname()
  const [user, setUser] = useState(null)

  const tabs = [
    ['/', '🏠', '首页'],
    ['/record', '🗺️', '记录'],
    ['/star-map', '🌌', '星图'],
    ['/report', '📜', '报告'],
    ['/chat', '💬', '小星'],
  ]

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then((s) => setUser(s.user))
  }, [path])

  async function logout() {
    await fetch('/api/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-in">
          <Link href="/" className="topbar-logo">
            <span className="flag">STAR MAP</span>
            <span className="cn">星图</span>
          </Link>
          <span className="topbar-user">
            {user && (
              <>
                <span>{user.starSymbol ? `${user.starSymbol} ` : '✦ '}<b>{user.username}</b></span>
                {user.role === 'admin' && (
                  <Link href="/admin" className="login-skip" style={{ textDecoration: 'none' }}>管理</Link>
                )}
                <Link href="/settings" className="login-skip" style={{ textDecoration: 'none' }}>设置</Link>
                <button className="login-skip" onClick={logout}>退出</button>
              </>
            )}
          </span>
        </div>
      </div>

      <nav className="tabbar">
        {tabs.map(([href, icon, label]) => (
          <Link key={href} href={href} className={path === href ? 'tab on' : 'tab'}>
            <i>{icon}</i>
            {label}
          </Link>
        ))}
      </nav>
    </>
  )
}
