'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import NavBar from '@/components/NavBar'

const DOMAINS = ['事业', '关系', '自我', '健康', '财务', '成长']
const W = 1000
const H = 700
const CX = 500
const CY = 350
const ZONE_R = 222
const ZONE_SIZE = 95
const ZODIAC_R = 322
const ZODIAC = ['白羊♈', '金牛♉', '双子♊', '巨蟹♋', '狮子♌', '处女♍', '天秤♎', '天蝎♏', '射手♐', '摩羯♑', '水瓶♒', '双鱼♓']

function hash(s) {
  let h = 0
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}
// 心情颜色：每种情绪一个专属颜色，不做正负向标注（避免心理暗示）
const EMO_COLORS = {
  焦虑: '#7b8cff',
  疲惫: '#5a6b8c',
  迷茫: '#8f9db8',
  愤怒: '#e05a5a',
  平静: '#6fc7a8',
  期待: '#f5c76a',
  低落: '#4a6fa5',
  充实: '#ff9a5c',
}

function colorFor(emotion) {
  return EMO_COLORS[emotion] || '#9aa3b2'
}

export default function StarMapPage() {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [showLegend, setShowLegend] = useState(true)
  const [asOf, setAsOf] = useState('')
  const [splitQuoteQ, setSplitQuoteQ] = useState(null)
  const [splitName, setSplitName] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [toast, setToast] = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  function refresh() {
    fetch(`/api/star-map${asOf ? `?asOf=${asOf}` : ''}`)
      .then((r) => r.json())
      .then(setData)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf])

  async function doSplit(q) {
    const r = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'split', topicId: selected.id, quote: q, newName: splitName }),
    })
    const d = await r.json()
    if (d.ok) {
      showToast(`已拆出新星星「${d.newTopic.name}」`)
      setSplitQuoteQ(null)
      setSelected(null)
      refresh()
    } else {
      showToast(d.error || '拆出失败')
    }
  }

  async function doMerge() {
    const r = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'merge', topicId: selected.id, toId: mergeTarget }),
    })
    const d = await r.json()
    if (d.ok) {
      showToast(`已合并到「${d.mergedInto}」`)
      setMergeTarget('')
      setSelected(null)
      refresh()
    } else {
      showToast(d.error || '合并失败')
    }
  }

  async function doRename() {
    const r = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', topicId: selected.id, newName: renameName }),
    })
    const d = await r.json()
    if (d.ok) {
      showToast(`已改名「${d.name}」`)
      setRenaming(false)
      setSelected(null)
      refresh()
    } else {
      showToast(d.error || '改名失败')
    }
  }

  const layout = useMemo(() => {
    if (!data) return { nodes: [], edges: [], domainPos: {} }
    const domainPos = {}
    DOMAINS.forEach((d, i) => {
      const a = ((i * 60 - 90) * Math.PI) / 180
      domainPos[d] = { x: CX + ZONE_R * Math.cos(a), y: CY + ZONE_R * Math.sin(a) }
    })
    const posById = {}
    const nodes = data.nodes.map((n) => {
      const dc = domainPos[n.domain] || { x: CX, y: CY }
      const r = rng(hash(n.id))
      const rr = Math.sqrt(r()) * (ZONE_SIZE - n.size)
      const aa = r() * Math.PI * 2
      const x = dc.x + rr * Math.cos(aa)
      const y = dc.y + rr * Math.sin(aa) * 0.75
      posById[n.id] = { x, y }
      return { ...n, x, y }
    })
    const edges = (data.edges || [])
      .map((e) => ({ ...e, from: posById[e.source], to: posById[e.target] }))
      .filter((e) => e.from && e.to)
    return { nodes, edges, domainPos }
  }, [data])

  const nameById = useMemo(() => {
    const m = {}
    for (const n of data?.nodes || []) m[n.id] = n.name
    return m
  }, [data])

  if (!data) return <div className="page"><div className="empty-state">正在展开星图…</div></div>

  const need = Math.max(0, 3 - data.dayCount)

  return (
    <div className="page">
      <div className="page-head">
        <h1>星图</h1>
        <span className="sub">
          {asOf ? `状态截至 ${asOf}` : `你的内心星图 · 已记录 ${data.dayCount} 天`}
        </span>
      </div>
      <NavBar />

      {data.dates?.length > 0 && (
        <div className="chips" style={{ marginBottom: 14 }}>
          <span className={!asOf ? 'chip on' : 'chip'} onClick={() => setAsOf('')}>
            最新状态
          </span>
          {data.dates.map((d) => (
            <span key={d} className={asOf === d ? 'chip on' : 'chip'} onClick={() => setAsOf(d)}>
              {d}
            </span>
          ))}
        </div>
      )}

      <div className="star-wrap">
        <svg className="star-svg" viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges">
          <rect width={W} height={H} fill="#0e1130" />

          {/* 像素星尘 */}
          {Array.from({ length: 110 }).map((_, i) => {
            const r = rng(i)
            const s = r() > 0.8 ? 4 : 2.5
            return (
              <rect
                key={`bg${i}`}
                x={r() * W}
                y={r() * H}
                width={s}
                height={s}
                fill={r() > 0.75 ? '#ffd34d' : '#aab4d0'}
                opacity={r() * 0.5 + 0.1}
              />
            )
          })}

          {/* 领域分区：虚线像素环 */}
          {DOMAINS.map((d) => {
            const p = layout.domainPos[d]
            return (
              <g key={d}>
                <circle cx={p.x} cy={p.y} r={ZONE_SIZE} fill="none" stroke="#3a4080" strokeWidth="2.5" strokeDasharray="3 9" />
                <text x={p.x} y={p.y - ZONE_SIZE - 12} textAnchor="middle" fill="#5a6098" fontSize="14" letterSpacing="4">
                  {d}
                </text>
              </g>
            )
          })}

          {/* 黄道星座环：用户的星座是星图起点 */}
          <circle cx={CX} cy={CY} r={ZODIAC_R} fill="none" stroke="#4a5088" strokeWidth="2" strokeDasharray="2 8" />
          {ZODIAC.map((s, i) => {
            const a = ((i * 30 - 90) * Math.PI) / 180
            const x = CX + ZODIAC_R * Math.cos(a)
            const y = CY + ZODIAC_R * Math.sin(a)
            const isMine = data.user?.starSymbol && s.includes(data.user.starSymbol)
            return (
              <g key={s}>
                {isMine && <rect x={x - 22} y={y - 22} width={44} height={44} fill="none" stroke="#ffd34d" strokeWidth={2.5} />}
                {isMine && (
                  <path d={`M ${CX} ${CY} H ${x} V ${y}`} fill="none" stroke="#ffd34d" strokeWidth={2} strokeDasharray="4 6" opacity={0.4} />
                )}
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={isMine ? 26 : 17}
                  fill={isMine ? '#ffd34d' : '#4a5088'}
                >
                  {s.replace(/[♈♉♊♋♌♍♎♏♐♑♒♓]/, '') === s ? s : s.slice(2)}
                </text>
                {isMine && (
                  <text x={x} y={y - 32} textAnchor="middle" fontSize={11} fill="#ffd34d" fontWeight="bold" letterSpacing="2">
                    起点
                  </text>
                )}
              </g>
            )
          })}

          {/* 中心：你 */}
          <rect x={CX - 26} y={CY - 26} width={52} height={52} fill="none" stroke="#ffd34d" strokeWidth={2.5} opacity={0.55} />
          <text x={CX} y={CY} textAnchor="middle" dominantBaseline="central" fontSize={22} fill="#ffd34d">
            {data.user?.starSymbol || '✦'}
          </text>
          <text x={CX} y={CY + 46} textAnchor="middle" fontSize={12} fill="#9aa0d0" letterSpacing="2">
            {data.user?.starSign ? `你 · ${data.user.starSign}座` : '你在星海某处'}
          </text>

          {/* 主题连线：90° 像素折线 */}
          {layout.edges.map((e, i) => (
            <path
              key={`e${i}`}
              d={`M ${e.from.x} ${e.from.y} H ${e.to.x} V ${e.to.y}`}
              fill="none"
              stroke="#6bb8ff"
              strokeWidth={2 + (e.weight || 0.3) * 2}
              opacity={0.18 + (e.weight || 0.3) * 0.4}
            />
          ))}

          {/* 心情色像素星：方块 + 内核 + 光晕 */}
          {layout.nodes.map((n) => {
            const c = colorFor(n.emotion)
            const s = n.size
            return (
              <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(n)}>
                <rect x={n.x - s * 1.9} y={n.y - s * 1.9} width={s * 3.8} height={s * 3.8} fill={c} opacity={0.16 * n.glow} />
                <rect x={n.x - s} y={n.y - s} width={s * 2} height={s * 2} fill={c} stroke="#f8f4e6" strokeWidth={2} />
                <rect x={n.x - s * 0.45} y={n.y - s * 0.45} width={s * 0.9} height={s * 0.9} fill="#12152e" opacity={0.5} />
                <text x={n.x} y={n.y + s + 16} textAnchor="middle" fontSize={12} fill="#c9cdea" fontWeight="bold">
                  {n.name}
                </text>
                <title>{`${n.name}（${n.emotion}）`}</title>
              </g>
            )
          })}
        </svg>

        <div className="star-toolbar">
          <button className="btn btn-ghost" onClick={() => setShowLegend((v) => !v)}>图例</button>
          <Link className="btn btn-primary" href="/report">查看状态报告 →</Link>
        </div>

        {showLegend && (
          <div className="legend legend-wide">
            <div className="legend-row">
              {Object.entries(EMO_COLORS).map(([em, c]) => (
                <span key={em}><i style={{ background: c }} />{em}</span>
              ))}
            </div>
            <div className="legend-row">颜色 = 心情 · 大小 = 提及频率 · 亮度 = 近期活跃</div>
          </div>
        )}
      </div>

      {(data.domains || []).length > 0 && (
        <>
          <div className="sec-title">— 六域能量 · DOMAIN STATUS —</div>
          <div className="domain-grid">
            {data.domains.map((d) => (
              <div key={d.domain} className="card domain-card">
                <div className="domain-head">
                  <span className="domain-name">{d.domain}</span>
                  <span className="domain-count">
                    {d.topicCount > 0 ? `${d.topicCount} 颗星 · 提及 ${d.freq} 次` : '还没有星星'}
                  </span>
                </div>
                {d.topicCount > 0 ? (
                  <>
                    <div className="domain-bar-row">
                      <div className="bar">
                        <i style={{ width: `${Math.max(3, d.share)}%`, background: d.color }} />
                      </div>
                      <span className="domain-share">{d.share}%</span>
                    </div>
                    <div className="domain-emo">
                      <span>主导情绪</span>
                      <span className="tag" style={{ borderColor: d.color }}>
                        <i style={{ background: EMO_COLORS[d.dominantEmotion] || d.color }} />
                        {d.dominantEmotion}
                      </span>
                    </div>
                    {(d.emoDist || []).length > 0 && (
                      <div className="emo-seg-bar">
                        {d.emoDist.map((e) => (
                          <i
                            key={e.emotion}
                            title={`${e.emotion} × ${e.count}`}
                            style={{
                              width: `${Math.max(3, Math.round((e.count / d.freq) * 100))}%`,
                              background: EMO_COLORS[e.emotion] || '#888',
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <div className="domain-foot muted">
                      最近活跃 {d.lastActive} · 域内关联 {d.edgeCount} 条
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                    这个板块还没有星星，去「记录星图」聊聊吧。
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {layout.nodes.length === 0 && (
        <div className="empty-state">
          {need > 0
            ? `再记录 ${need} 天，你的星图就会出现\n（粒子 = 你的念头，颜色 = 情绪，连线 = 关联）`
            : '星图正在生成…'}
        </div>
      )}

      {data.nodes?.length > 0 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          归类不准？点开任意星星：每条原话都可以「拆出」成独立的星星，也可以「合并」到另一颗。
        </p>
      )}

      {selected && (
        <div className="drawer">
          <button className="close" onClick={() => setSelected(null)}>×</button>
          <h3>{selected.name}</h3>
          <div className="meta">
            {selected.domain} · 情绪：{selected.emotion} · 提及 {selected.freq} 次 · 最近活跃 {selected.lastActive}
          </div>
          {(selected.quotes || []).map((q, i) => (
            <div key={i} className="quote">“{q}”</div>
          ))}
          <div className="muted" style={{ marginTop: 14 }}>
            关联主题：
            {layout.edges
              .filter((e) => e.source === selected.id || e.target === selected.id)
              .map((e) => nameById[e.source === selected.id ? e.target : e.source])
              .filter(Boolean)
              .slice(0, 5)
              .join('、') || '暂无'}
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label>给这颗星星改名</label>
            {renaming ? (
              <div className="chat-input-row" style={{ margin: '6px 0' }}>
                <input
                  type="text"
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  placeholder="新名字"
                  autoFocus
                />
                <button className="btn btn-ghost" onClick={doRename}>确认</button>
                <button className="login-skip" onClick={() => setRenaming(false)}>取消</button>
              </div>
            ) : (
              <button
                className="btn btn-ghost"
                style={{ width: '100%' }}
                onClick={() => {
                  setRenameName(selected.name)
                  setRenaming(true)
                }}
              >
                ✏️ 改名
              </button>
            )}
          </div>

          {(selected.quotes || []).length > 1 && (
            <div className="field">
              <label>归类不准？每条原话可以拆成独立的星星</label>
              {(selected.quotes || []).map((q) =>
                splitQuoteQ === q ? (
                  <div key={q} className="chat-input-row" style={{ margin: '6px 0' }}>
                    <input
                      type="text"
                      value={splitName}
                      onChange={(e) => setSplitName(e.target.value)}
                      placeholder="新星星的名字"
                      autoFocus
                    />
                    <button className="btn btn-ghost" onClick={() => doSplit(q)}>确认拆出</button>
                    <button className="login-skip" onClick={() => setSplitQuoteQ(null)}>取消</button>
                  </div>
                ) : (
                  <div key={q} className="track-item" style={{ marginBottom: 6 }}>
                    <span style={{ flex: 1 }}>“{q}”</span>
                    <button
                      className="login-skip"
                      onClick={() => {
                        setSplitQuoteQ(q)
                        setSplitName(q.slice(0, 10))
                      }}
                    >
                      拆出
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {(selected.quotes || []).length <= 1 && (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
              这颗星星只有一条内容，拆不了——想调整归类可以改名，或合并到另一颗星星。
            </p>
          )}

          <div className="field">
            <label>或合并到另一颗星星</label>
            <div className="chat-input-row" style={{ margin: 0 }}>
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                <option value="">选择星星…</option>
                {data.nodes
                  .filter((n) => n.id !== selected.id)
                  .map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
              </select>
              <button className="btn btn-ghost" disabled={!mergeTarget} onClick={doMerge}>合并</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
