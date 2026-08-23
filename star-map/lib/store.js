import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), 'data')
const PROFILE_PATH = path.join(DATA_DIR, 'profile.json')
const DAYS_PATH = path.join(DATA_DIR, 'days.json')

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function defaultProfile() {
  return {
    user: { cohort: null, careerStage: '', personaTier: 'logical' },
    topics: [],
    edges: [],
    feedbackLog: [],
    emotionSeries: [],
    lastReport: null,
    reports: {}, // 历史日报告缓存：{date: report}，首看生成后不再重复生成
    periodReports: {}, // 周期报告缓存：{week|month|quarter|year: report}
    behavior: null, // 行为层画像（lib/behavior.js 首次使用时初始化）
    openerIdx: 0, // 开场问题轮换指针
    lastOpeners: [], // 最近用过的开场框架
    adaptLog: [], // 自迭代审计日志
  }
}

export function readProfile() {
  ensure()
  if (!fs.existsSync(PROFILE_PATH)) {
    const p = defaultProfile()
    writeProfile(p)
    return p
  }
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'))
  } catch {
    return defaultProfile()
  }
}

export function writeProfile(p) {
  ensure()
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(p, null, 2), 'utf8')
}

export function readDays() {
  ensure()
  if (!fs.existsSync(DAYS_PATH)) return []
  try {
    return JSON.parse(fs.readFileSync(DAYS_PATH, 'utf8'))
  } catch {
    return []
  }
}

export function writeDays(d) {
  ensure()
  fs.writeFileSync(DAYS_PATH, JSON.stringify(d, null, 2), 'utf8')
}
