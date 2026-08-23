'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavBar() {
  const path = usePathname()
  const [user, setUser] = useState(null)
  const items = [
    ['/record', '记录'],
    ['/chat', '小星'],
    ['/star-map', '星图'],
    ['/report', '报告'],
    ['/tests', '测试'],
  ]

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then((s) => setUser(s.user))
  }, [path])

  async function logout() {
    await fetch('/api/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <div className="nav-wrap">
      <nav className="nav">
        <Link href="/" className={path === '/' ? 'nav-logo on' : 'nav-logo'}>✦ 星图</Link>
        {items.map(([href, label]) => (
          <Link key={href} href={href} className={path === href ? 'nav-item active' : 'nav-item'}>
            {label}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        {user && (
          <span className="nav-user">
            {user.starSymbol ? `${user.starSymbol} ` : '✦ '}{user.username}
            <button className="nav-logout" onClick={logout}>退出</button>
          </span>
        )}
      </nav>
    </div>
  )
}
