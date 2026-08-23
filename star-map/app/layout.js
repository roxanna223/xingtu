import './globals.css'
import AuthGate from '@/components/AuthGate'
import Starfield from '@/components/Starfield'

export const metadata = {
  title: '星图 · 看见自己',
  description: 'AI 自我状态导航：长期对话 → 内心星图 → 状态报告 → 指路',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#12152e',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <Starfield />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  )
}
