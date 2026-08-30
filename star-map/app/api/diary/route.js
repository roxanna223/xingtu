import { getDB } from '@/lib/db'
import { readProfile, writeProfile, readDays, writeDays, readJournal, writeJournal, appendStream, readStream, withStoreLock } from '@/lib/store'
import { extractAndMerge, generateDaySummary } from '@/lib/engine'
import { syncGoalsWithText } from '@/lib/goals'
import { updateBehavior } from '@/lib/behavior'
import { consumePendingChats } from '@/lib/chatStore'
import { rebuildPersonaDocs } from '@/lib/evolution'
import { formatStream } from '@/lib/stream'
import { questionOfDay } from '@/lib/guideQuestions'
import { requireAuth, assertSameOrigin, readJsonBody } from '@/lib/auth'
import { trackReq } from '@/lib/track'
import { todayKey, dayKeyOfIso, nowIso } from '@/lib/day'

/**
 * 日记模块（docs/23 统一方案 §4.3）：
 * - GET  : 读取某天的日记（打开即当天）+「今日一问」轻引导
 * - POST : 保存（自由书写 + 情绪点选）→ 写 journals + 镜像 days + 事件流 → 后台抽取/日报/目标同步/进化资产重建
 * 日记不强制：无内容的日子不写行；日报只归纳"有的内容"，不催写。
 */

export async function GET(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  const url = new URL(req.url)

  // 日历模式：某月内写过/点过心情的日子（含情绪点选，供月历回顾）
  const month = url.searchParams.get('month')
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const jparse = (s) => {
      try {
        return JSON.parse(s || '[]')
      } catch {
        return []
      }
    }
    const rows = getDB()
      .prepare("SELECT date, mood FROM journals WHERE user_id = ? AND date LIKE ? ORDER BY date")
      .all(userId, `${month}%`)
    return Response.json({ month, days: rows.map((r) => ({ date: r.date, mood: jparse(r.mood) })) })
  }

  const date = url.searchParams.get('date') || todayKey()
  const qOffset = parseInt(url.searchParams.get('qOffset') || '0', 10) || 0
  const j = readJournal(userId, date)
  return Response.json({
    date,
    content: j?.content || '',
    mood: j?.mood || [],
    updatedAt: j?.updatedAt || null,
    question: questionOfDay(date, qOffset),
    questionFrame: questionOfDay(date, qOffset).frame,
  })
}

export async function POST(req) {
  const auth = requireAuth(req)
  if (!auth.user) return auth.response
  const userId = auth.user.id
  if (!assertSameOrigin(req)) return Response.json({ error: '跨站请求被拒绝' }, { status: 403 })
  const body = await readJsonBody(req)
  if (body.__error) return Response.json({ error: body.__error }, { status: 400 })

  const date = String(body.date || todayKey()).slice(0, 10)
  const appendMode = body.append === true
  let content = String(body.content || '').trim().slice(0, 20000)
  const mood = Array.isArray(body.mood) ? body.mood.map((m) => String(m).slice(0, 8)).filter(Boolean).slice(0, 8) : []
  if (!content && !mood.length) return Response.json({ error: '写点什么，或至少点一下今天的心情吧' }, { status: 400 })

  const moodText = mood.length ? `今日心情（${mood.join('、')}）` : ''
  const firstLine = content.split('\n').find((l) => l.trim()) || ''

  const { topicCount, dayCount } = await withStoreLock(async () => {
    const p = readProfile(userId)
    // 追加模式（F3：小星梳理结论追加进日记，绝不覆盖已写内容）
    if (appendMode) {
      const existing = readJournal(userId, date)?.content || ''
      if (existing.trim()) content = existing.trimEnd() + '\n\n【小星梳理】\n' + content
    }
    // 日记全文走与记录相同的抽取管线（主题/情绪/关联入画像），q2 由情绪点选生成
    const record = { date, freeText: content, q1: firstLine.slice(0, 80), q2: moodText, q3: '' }
    if (content) {
      await extractAndMerge(record, p)
      updateBehavior(p, [content])
    } else {
      // 只点情绪：也写入情绪序列（低摩擦记录仍被看见）
      if (!(p.emotionSeries || []).some((e) => e.date === date)) {
        p.emotionSeries.push({ date, topEmotion: mood[0], intensity: 3 })
        p.emotionSeries.sort((a, b) => a.date.localeCompare(b.date))
      }
    }
    p.generating = true
    writeProfile(userId, p)

    // 日记事实源（journals）+ 旧 days 镜像（周期报告/历史清单兼容）
    // F17：修改有反馈——覆盖已有内容时写"更新日记"事件，次日日报会看见
    const existedBefore = readJournal(userId, date)
    writeJournal(userId, date, content, mood)
    const days = readDays(userId)
    const i = days.findIndex((d) => d.date === date)
    if (i >= 0) days[i] = record
    else days.push(record)
    days.sort((a, b) => a.date.localeCompare(b.date))
    writeDays(userId, days)

    // 人生事件流（日记段落事件）
    appendStream(userId, { day: dayKeyOfIso(nowIso()), kind: 'diary_entry', data: { text: content.slice(0, 2000), mood } })
    if ((existedBefore?.content || '').trim() && appendMode) {
      appendStream(userId, { day: dayKeyOfIso(nowIso()), kind: 'diary_edit', data: { text: '追加了梳理内容' } })
    } else if ((existedBefore?.content || '').trim() !== content) {
      appendStream(userId, { day: dayKeyOfIso(nowIso()), kind: 'diary_edit', data: { text: '更新了日记内容' } })
    }

    return { topicCount: p.topics.length, dayCount: days.length }
  })

  // 后台：① 未抽取对话并入画像 → ② 生成"今天小结"（轻量，不进报告缓存；完整日报留给次日 6:00）→ ③ 目标同步 → ④ 进化资产文档重建（同一条串行链 + 写锁）
  ;(async () => {
    try {
      await withStoreLock(async () => {
        await consumePendingChats(userId)
        const latest = readProfile(userId)
        const lastD = readDays(userId).at(-1)
        const streamText = formatStream(readStream(userId, lastD?.date || date))
        const dayText = `${lastD?.freeText || ''}\n${streamText}`.trim()
        // R6：即时小结（日记保存后立刻可见，不等次日 6:00）
        const summary = await generateDaySummary(latest, dayText)
        if (summary.text) {
          latest.daySummaries = latest.daySummaries || {}
          latest.daySummaries[lastD?.date || date] = summary
        }
        const goalText = `${lastD?.freeText || ''} ${lastD?.q1 || ''} ${lastD?.q3 || ''}`.trim()
        if (goalText && (latest.goals || []).some((g) => g.status === 'active')) {
          await syncGoalsWithText(latest, goalText, 'record')
        }
        rebuildPersonaDocs(userId, latest)
        latest.generating = false
        writeProfile(userId, latest)
      })
    } catch (e) {
      await withStoreLock(() => {
        const fresh = readProfile(userId)
        fresh.generating = false
        writeProfile(userId, fresh)
      })
      console.warn('[diary] 后台小结生成失败：', e.message)
    }
  })()

  trackReq(req, 'diary_save', '/api/diary')
  return Response.json({ ok: true, topicCount, dayCount })
}
