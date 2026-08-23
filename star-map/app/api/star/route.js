import { readProfile, writeProfile } from '@/lib/store'
import { callLLM, parseJson, mockStar, mockSuggestions, buildProfileSummary } from '@/lib/engine'
import { starMessages, suggestionsMessages } from '@/lib/prompts'
import { updateBehavior } from '@/lib/behavior'

export async function POST(req) {
  const body = await req.json()
  const { messages = [], quiz = null, mode = 'chat' } = body || {}

  const p = readProfile()

  // 行为信号采集（小星对话同样计入自迭代数据）
  updateBehavior(p, messages.filter((m) => m.role === 'user').map((m) => m.content))
  writeProfile(p)

  const summary = buildProfileSummary(p)

  // 快速开始提示生成
  if (mode === 'suggestions') {
    if (!process.env.DEEPSEEK_API_KEY) return Response.json(mockSuggestions(summary))
    try {
      const raw = await callLLM(suggestionsMessages(summary))
      const parsed = parseJson(raw)
      if (parsed && Array.isArray(parsed.suggestions) && parsed.suggestions.length) {
        return Response.json({ suggestions: parsed.suggestions.slice(0, 3) })
      }
    } catch (e) {
      console.warn('[star] suggestions 失败：', e.message)
    }
    return Response.json(mockSuggestions(summary))
  }

  // 对话 / 测验
  let out
  if (!process.env.DEEPSEEK_API_KEY) {
    out = mockStar(messages, quiz, summary)
  } else {
    try {
      const raw = await callLLM(starMessages({ history: messages, quiz, profileSummary: summary }))
      const parsed = parseJson(raw)
      out = {
        reply: parsed?.reply || '嗯，我在。',
        quiz: parsed?.quiz || null,
        result: parsed?.result || null,
      }
    } catch (e) {
      console.warn('[star] 对话失败，降级 Mock：', e.message)
      out = mockStar(messages, quiz, summary)
    }
  }

  // 测验结果自动存入测试报告
  if (out.result) {
    p.tests = p.tests || []
    p.tests.unshift({ date: new Date().toISOString().slice(0, 10), ...out.result })
    writeProfile(p)
  }

  return Response.json(out)
}
