// 心理侧写式轻引导题库（docs/23 §4.2）：
// 设计原则——不审问、不废话、低压可跳过：每个问题具体、有画面感、可一句话作答，
// 旨在让用户"自己说出今天"，而不是被盘问。用于：①日记「今日一问」；②小星记录引导的轻抛问题。
// 与旧 openers.js（CBT 情境锁定式、压力大）的区别：这里刻意去掉"最/最后悔/起伏最大"等极限词。

import { fakeTodayISO } from './clock.js'

export const GUIDE_QUESTIONS = [
  { frame: '味道', q: '如果今天是一杯饮料，你觉得它是什么味道的？' },
  { frame: '画面', q: '现在回想今天，最先跳进脑子里的画面是什么？' },
  { frame: '分享欲', q: '今天有没有哪一刻，你想截图发给谁看看？' },
  { frame: '心思', q: '今天哪件事占了你最多心思？' },
  { frame: '小开心', q: '今天有什么小事，让你意外地开心了一下？' },
  { frame: '为自己', q: '今天你为自己做的一件事是什么？哪怕很小。' },
  { frame: '停一下', q: '今天有没有哪个瞬间，你希望时间停一下？' },
  { frame: '电量', q: '今天你的电量到晚上还剩多少？是什么把它用掉的？' },
  { frame: '舒服或累', q: '今天和谁相处最舒服，或最累？就说说你的感受。' },
  { frame: '脑子里转', q: '今天有没有一个想法，在脑子里转了好几圈？' },
  { frame: '新东西', q: '今天你注意到的一件新东西，或学到的小事是什么？' },
  { frame: '身体信号', q: '今天身体有没有给你什么小信号？比如肩膀、胃、眼睛。' },
  { frame: '明天一件', q: '如果明天醒来只做一件事，你最想先做哪件？' },
  { frame: '没说的话', q: '今天有没有一句憋住没说的话？说给我听也没关系。' },
]

/** 按日期稳定取一条（同日固定，适合「今日一问」） */
export function questionOfDay(dateStr = '', offset = 0) {
  const s = String(dateStr || fakeTodayISO())
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return GUIDE_QUESTIONS[(h + offset) % GUIDE_QUESTIONS.length]
}

/** 「换一换」：取另一条（顺延，越点越后） */
export function nextQuestion(current, offset = 0) {
  const idx = GUIDE_QUESTIONS.findIndex((g) => g.q === current?.q)
  const from = idx >= 0 ? idx + 1 + offset : offset
  return GUIDE_QUESTIONS[from % GUIDE_QUESTIONS.length]
}
