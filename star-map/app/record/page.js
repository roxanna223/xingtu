import { redirect } from 'next/navigation'

// 记录页已重构为「日记」模块（docs/23 统一方案 §4.3）：对话式记录并入小星。
export default function RecordPage() {
  redirect('/diary')
}
