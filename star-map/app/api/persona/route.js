import { readProfile, writeProfile, readPersonaDocs, deletePersonaDocs } from '@/lib/store'
import { decayMeta, mergeInstincts } from '@/lib/evolution'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'

/**
 * 小星进化层 · 个人资产（docs/23 §4.1）：用户主权接口——查看/认可/纠正/删除/晋升/导出/重置。
 * 记忆≠指令：所有条目默认 unreviewed；"晋升"由用户手动确认（trust: confirmed）。
 */

function bump(meta, id, delta) {
  const list = decayMeta(meta)
  const hit = list.find((e) => e.id === id)
  if (!hit) return list
  hit.confidence = Math.max(0.05, Math.min(0.9, Math.round((hit.confidence + delta) * 100) / 100))
  return list.filter((e) => e.confidence >= 0.2)
}

export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  const p = readProfile(userId)
  const meta = decayMeta(p.personaMeta || [])
  const docs = readPersonaDocs(userId)

  const url = new URL(req.url)
  if (url.searchParams.get('export') === '1') {
    // 导出个人资产（JSON 下载）
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), docs, meta }, null, 2)
    return new Response(payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="xiaoxing-persona-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  }

  return Response.json({
    docs,
    meta,
    stats: {
      count: meta.length,
      confirmed: meta.filter((e) => e.trust === 'confirmed').length,
      avgConf: meta.length ? Math.round((meta.reduce((s, e) => s + e.confidence, 0) / meta.length) * 100) : 0,
    },
  })
}

export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })
  const { action, id } = body
  const p = readProfile(userId)

  const actions = ['confirm', 'correct', 'delete', 'promote', 'reset']
  if (!actions.includes(action)) return Response.json({ error: '未知操作' }, { status: 400 })

  if (action === 'reset') {
    p.personaMeta = []
    writeProfile(userId, p)
    deletePersonaDocs(userId)
    trackReq(req, 'persona_reset', '/api/persona')
    return Response.json({ ok: true, meta: [] })
  }

  if (action === 'confirm' || action === 'correct') {
    const delta = action === 'confirm' ? 0.05 : -0.1
    p.personaMeta = bump(p.personaMeta || [], String(id || ''), delta)
    writeProfile(userId, p)
    trackReq(req, `persona_${action}`, '/api/persona', { id })
    return Response.json({ ok: true, meta: p.personaMeta })
  }

  if (action === 'delete') {
    p.personaMeta = (p.personaMeta || []).filter((e) => e.id !== id)
    writeProfile(userId, p)
    trackReq(req, 'persona_delete', '/api/persona', { id })
    return Response.json({ ok: true, meta: p.personaMeta })
  }

  if (action === 'promote') {
    p.personaMeta = mergeInstincts(
      (p.personaMeta || []).map((e) => (e.id === id ? { ...e, trust: 'confirmed' } : e)),
      []
    )
    writeProfile(userId, p)
    trackReq(req, 'persona_promote', '/api/persona', { id })
    return Response.json({ ok: true, meta: p.personaMeta })
  }
}
