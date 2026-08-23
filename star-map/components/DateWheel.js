'use client'

import { useEffect, useRef, useState } from 'react'

const ITEM_H = 40

function pad(n) {
  return String(n).padStart(2, '0')
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate()
}

// 年月日三列滑动滚轮选择器；用户滑动后才向外输出值
export default function DateWheel({ onPick }) {
  const thisYear = new Date().getFullYear()
  const years = []
  for (let i = thisYear - 12; i >= thisYear - 80; i--) years.push(i)
  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  const [y, setY] = useState(years[20] ?? years[0])
  const [m, setM] = useState(1)
  const [d, setD] = useState(1)
  const touched = useRef(false)

  const yRef = useRef(null)
  const mRef = useRef(null)
  const dRef = useRef(null)

  const maxDay = daysInMonth(y, m)
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  useEffect(() => {
    if (yRef.current) yRef.current.scrollTop = years.indexOf(y) * ITEM_H
    if (mRef.current) mRef.current.scrollTop = (m - 1) * ITEM_H
    if (dRef.current) dRef.current.scrollTop = (d - 1) * ITEM_H
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 月/年变化时夹紧日
  useEffect(() => {
    if (d > maxDay) setD(maxDay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y, m])

  useEffect(() => {
    if (touched.current && onPick) onPick(`${y}-${pad(m)}-${pad(d)}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y, m, d])

  function handleScroll(ref, setter, list, idxKey) {
    return (e) => {
      touched.current = true
      const idx = Math.round(e.target.scrollTop / ITEM_H)
      const v = list[Math.max(0, Math.min(list.length - 1, idx))]
      setter(v)
    }
  }

  function goTo(ref, idx) {
    touched.current = true
    ref.current?.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' })
  }

  const col = (list, val, setter, ref, label) => (
    <div className="wheel-col">
      <div className="wheel-label">{label}</div>
      <div className="wheel-list" ref={ref} onScroll={handleScroll(ref, setter, list)}>
        {list.map((v) => (
          <div
            key={v}
            className={v === val ? 'wheel-item on' : 'wheel-item'}
            onClick={() => goTo(ref, list.indexOf(v))}
          >
            {v}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="wheel">
      {col(years, y, setY, yRef, '年')}
      {col(months, m, setM, mRef, '月')}
      {col(days, d, setD, dRef, '日')}
    </div>
  )
}
