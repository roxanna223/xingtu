'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

// 本地模拟登录门卫：未登录访问除 /login 外页面 → 跳登录页
export default function AuthGate({ children }) {
  const [ok, setOk] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === '/login') {
      setOk(true)
      return
    }
    fetch('/api/status')
      .then((r) => r.json())
      .then((s) => {
        if (s.loggedIn) setOk(true)
        else window.location.href = '/login'
      })
  }, [pathname])

  // 埋点:页面浏览(路由变化上报;管理员操作由服务端过滤不记录)
  useEffect(() => {
    if (pathname === '/login') return
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'page_view', path: pathname }),
    }).catch(() => {})
  }, [pathname])

  if (pathname === '/login') return children
  if (!ok) {
    return (
      <div className="page">
        <div className="empty-state">正在进入星图…</div>
      </div>
    )
  }
  return children
}
