// 像素星天背景：确定性伪随机（SSR/客户端一致，无水合不匹配）
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const COLORS = ['#f8f4e6', '#f8f4e6', '#f8f4e6', '#ffd34d', '#6bb8ff', '#ff9ad5']

export default function Starfield({ count = 90 }) {
  const r = rng(20261024)
  const stars = Array.from({ length: count }, (_, i) => ({
    left: r() * 100,
    top: r() * 100,
    delay: r() * 2.4,
    size: r() > 0.85 ? 4 : 3,
    color: COLORS[Math.floor(r() * COLORS.length)],
    key: i,
  }))
  return (
    <div className="px-sky" aria-hidden="true">
      {stars.map((s) => (
        <i
          key={s.key}
          style={{
            left: `${s.left.toFixed(2)}%`,
            top: `${s.top.toFixed(2)}%`,
            animationDelay: `${s.delay.toFixed(2)}s`,
            width: s.size,
            height: s.size,
            background: s.color,
          }}
        />
      ))}
    </div>
  )
}
