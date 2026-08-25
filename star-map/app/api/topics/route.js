import { readProfile, writeProfile } from '@/lib/store'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'

// 手动矫正星图归类：拆出独立星星 / 合并到另一颗星星
export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { action, topicId, quote, newName, toId } = body
  const p = readProfile(userId)
  const t = p.topics.find((x) => x.id === topicId)
  if (!t) return Response.json({ error: '星星不存在' }, { status: 404 })

  if (action === 'split') {
    const q = String(quote || '').trim().slice(0, 40)
    if (!q) return Response.json({ error: '请选择要拆出的内容' }, { status: 400 })
    t.quotes = (t.quotes || []).filter((x) => x !== q)
    t.freq = Math.max(0, (t.freq || 1) - 1)
    const nt = {
      id: 't' + Math.random().toString(36).slice(2, 8),
      name: String(newName || '新的星星').trim().slice(0, 20),
      domain: t.domain,
      emotion: t.emotion,
      polarity: t.polarity ?? 0,
      _polSum: 0,
      _polCount: 0,
      firstSeen: t.firstSeen,
      lastActive: t.lastActive,
      freq: 1,
      quotes: [q],
    }
    p.topics.push(nt)

    // 拆空后原星自动消失（避免出现"复制出来一颗一样的星星"）
    if (t.quotes.length === 0 && t.freq === 0) {
      for (const e of p.edges) {
        if (e.source === t.id) e.source = nt.id
        if (e.target === t.id) e.target = nt.id
      }
      const seen = new Set()
      p.edges = p.edges.filter((e) => {
        if (e.source === e.target) return false
        const k = [e.source, e.target].sort().join('|')
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      p.topics = p.topics.filter((x) => x.id !== t.id)
      writeProfile(userId, p)
      return Response.json({ ok: true, newTopic: nt, removedOriginal: true })
    }

    p.edges.push({ source: t.id, target: nt.id, weight: 0.3 })
    writeProfile(userId, p)
    return Response.json({ ok: true, newTopic: nt })
  }

  if (action === 'rename') {
    const name = String(newName || '').trim()
    if (!name) return Response.json({ error: '名字不能为空' }, { status: 400 })
    t.name = name.slice(0, 20)
    writeProfile(userId, p)
    return Response.json({ ok: true, name: t.name })
  }

  if (action === 'merge') {
    const target = p.topics.find((x) => x.id === toId)
    if (!target || target.id === t.id) return Response.json({ error: '目标星星无效' }, { status: 400 })
    target.quotes = [...new Set([...(target.quotes || []), ...(t.quotes || [])])].slice(-5)
    target.freq = (target.freq || 0) + (t.freq || 0)
    const n1 = t._polCount || 1
    const n2 = target._polCount || 1
    target._polSum = (t._polSum || 0) + (target._polSum || 0)
    target._polCount = n1 + n2
    target.polarity = Math.round((target._polSum / target._polCount) * 100) / 100
    p.edges = (p.edges || []).filter(
      (e) =>
        !(e.source === t.id && e.target === target.id) &&
        !(e.source === target.id && e.target === t.id)
    )
    for (const e of p.edges) {
      if (e.source === t.id) e.source = target.id
      if (e.target === t.id) e.target = target.id
    }
    const seen = new Set()
    p.edges = p.edges.filter((e) => {
      if (e.source === e.target) return false
      const k = [e.source, e.target].sort().join('|')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    p.topics = p.topics.filter((x) => x.id !== t.id)
    writeProfile(userId, p)
    return Response.json({ ok: true, mergedInto: target.name })
  }

  return Response.json({ error: '未知操作' }, { status: 400 })
}
