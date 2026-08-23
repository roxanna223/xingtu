'use client'

// 今日心情卡「图片」：渐变背景 + 图案（钻石/小花/月亮…）+ 像素星尘
// 由心情卡参数(mood)本地渲染，无需模型、零 token、秒出；与像素风保持一致

function Motif({ type }) {
  const c = '#ffffff'
  switch (type) {
    case 'gem': // 钻石
      return (
        <g>
          <polygon points="160,52 208,90 160,150 112,90" fill="rgba(255,255,255,.9)" stroke="#fff" strokeWidth="2" />
          <polygon points="160,52 208,90 160,90" fill="rgba(255,255,255,.45)" />
          <polygon points="160,90 208,90 160,150" fill="rgba(255,255,255,.25)" />
          <line x1="112" y1="90" x2="208" y2="90" stroke="#fff" strokeWidth="1.5" opacity=".6" />
          <circle cx="138" cy="66" r="3" fill="#fff" />
        </g>
      )
    case 'flower': // 小花（像素四瓣）
      return (
        <g>
          {[[0, -22], [0, 22], [-22, 0], [22, 0]].map(([dx, dy], i) => (
            <rect key={i} x={160 + dx - 9} y={101 + dy - 9} width="18" height="18" fill="#fff" />
          ))}
          <circle cx="160" cy="101" r="10" fill="#ffe08a" stroke="#fff" strokeWidth="2" />
        </g>
      )
    case 'moon': // 月牙
      return (
        <path
          d="M 178 56 A 40 40 0 1 0 178 136 A 32 32 0 1 1 178 56 Z"
          fill="#fff"
        />
      )
    case 'sun': // 太阳
      return (
        <g fill="#fff">
          <circle cx="160" cy="96" r="24" />
          <rect x="156" y="44" width="8" height="16" />
          <rect x="156" y="132" width="8" height="16" />
          <rect x="108" y="92" width="16" height="8" />
          <rect x="196" y="92" width="16" height="8" />
          <rect x="128" y="64" width="8" height="8" />
          <rect x="184" y="120" width="8" height="8" />
          <rect x="184" y="64" width="8" height="8" />
          <rect x="128" y="120" width="8" height="8" />
        </g>
      )
    case 'sprout': // 新芽
      return (
        <g stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M160 130 V 84" />
          <path d="M160 100 Q 138 96 134 78" />
          <path d="M160 112 Q 182 108 186 90" />
        </g>
      )
    case 'cloud': // 云
      return (
        <g fill="#fff">
          <rect x="120" y="96" width="80" height="26" rx="10" />
          <circle cx="138" cy="92" r="14" />
          <circle cx="168" cy="86" r="20" />
          <circle cx="194" cy="94" r="12" />
        </g>
      )
    case 'bolt': // 闪电
      return <polygon points="172,50 134,106 158,106 148,150 188,94 162,94" fill="#fff" />
    case 'compass': // 指南针
      return (
        <g>
          <circle cx="160" cy="96" r="34" fill="none" stroke="#fff" strokeWidth="3" />
          <polygon points="160,70 170,96 160,122 150,96" fill="#fff" />
          <circle cx="160" cy="96" r="4" fill="#0e1130" />
        </g>
      )
    case 'whale': // 鲸鱼
      return (
        <g fill="#fff">
          <ellipse cx="150" cy="100" rx="38" ry="22" />
          <polygon points="120,100 98,84 104,112" />
          <circle cx="170" cy="92" r="3" fill="#0e1130" />
        </g>
      )
    case 'tea': // 茶
      return (
        <g>
          <rect x="132" y="84" width="56" height="42" fill="#fff" />
          <path d="M188 92 h16 a8 8 0 0 1 0 26 h-16" fill="none" stroke="#fff" strokeWidth="5" />
          <path d="M146 62 q6 -10 14 0" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M158 56 q6 -10 14 0" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
      )
    case 'snow': // 雪晶
      return (
        <g stroke="#fff" strokeWidth="4" strokeLinecap="round">
          <line x1="160" y1="62" x2="160" y2="130" />
          <line x1="126" y1="82" x2="194" y2="110" />
          <line x1="194" y1="82" x2="126" y2="110" />
          <line x1="160" y1="62" x2="160" y2="130" />
        </g>
      )
    case 'rain': // 雨
      return (
        <g fill="#fff">
          <rect x="128" y="70" width="64" height="20" rx="8" />
          <circle cx="144" cy="66" r="10" />
          <circle cx="166" cy="62" r="13" />
          <line x1="140" y1="104" x2="134" y2="122" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
          <line x1="164" y1="104" x2="158" y2="122" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
          <line x1="186" y1="104" x2="180" y2="122" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        </g>
      )
    case 'star': // 星
      return <polygon points="160,50 170,86 208,90 176,114 184,150 160,128 136,150 144,114 112,90 150,86" fill="#fff" />
    case 'heart': // 心
      return (
        <g fill="#fff">
          <circle cx="142" cy="88" r="20" />
          <circle cx="178" cy="88" r="20" />
          <polygon points="122,96 160,140 198,96" />
        </g>
      )
    case 'leaf': // 叶
      return (
        <g>
          <path d="M160 130 Q 128 108 128 78 Q 160 70 160 60 Q 188 72 190 96 Q 188 122 160 130 Z" fill="#fff" />
          <line x1="160" y1="128" x2="160" y2="66" stroke="rgba(0,0,0,.18)" strokeWidth="2.5" />
        </g>
      )
    case 'bubble': // 气泡
      return (
        <g fill="none" stroke="#fff" strokeWidth="3">
          <circle cx="132" cy="100" r="18" />
          <circle cx="168" cy="74" r="12" />
          <circle cx="188" cy="104" r="8" />
        </g>
      )
    case 'mountain': // 远山
      return (
        <g fill="#fff">
          <polygon points="104,136 146,70 172,108 188,88 216,136" />
          <polygon points="104,136 146,70 172,108 188,88 216,136" fill="rgba(255,255,255,.55)" transform="translate(0,-2)" opacity=".4" />
        </g>
      )
    default: // 兜底：钻石
      return <Motif type="gem" />
  }
}

export default function MoodCard({ mood = {}, note = '' }) {
  const { name = '雾灰', line = '', motif = 'gem', hex1 = '#8f9db8', hex2 = '#b8c2d4' } = mood || {}
  // 星尘（确定性伪随机）
  const stars = Array.from({ length: 16 }, (_, i) => {
    const a = (i * 37.5) % 97
    const x = 8 + ((i * 53) % 300)
    const y = 8 + ((i * 71) % 180)
    return { x, y, s: i % 3 === 0 ? 3 : 2, o: 0.3 + (a % 50) / 100 }
  })

  return (
    <svg
      className="mood-card-img"
      viewBox="0 0 320 200"
      role="img"
      aria-label={`${name}${line ? ' · ' + line : ''}${note ? ' · ' + note : ''}`}
      shapeRendering="crispEdges"
    >
      <defs>
        <linearGradient id="moodGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={hex1} />
          <stop offset="100%" stopColor={hex2} />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill="url(#moodGrad)" />
      <rect x="3" y="3" width="314" height="194" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="2" />
      {stars.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.s} height={s.s} fill="#fff" opacity={s.o} />
      ))}
      <Motif type={motif} />
    </svg>
  )
}
