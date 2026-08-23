// cohort 特征表（静态预置，不实时排盘）
// 文档口径：文化符号资产的工程化使用——把用户的命理式自我叙事翻译为可计算的代际/人生阶段特征。
// 代码与文档中一律用 "cohort 特征"，不用 "八字"。

export function cohortFor(birthYearMonth) {
  const m = String(birthYearMonth || '').match(/^(\d{4})-?(\d{2})?$/)
  if (!m) return null
  const year = Number(m[1])
  let generation, lifeTask
  if (year >= 2003) {
    generation = 'Z世代早期'
    lifeTask = '在途期：探索方向、建立第一份职业认同'
  } else if (year >= 1995) {
    generation = 'Z世代'
    lifeTask = '立业期：职业方向收敛、经济独立'
  } else if (year >= 1989) {
    generation = '千禧初段'
    lifeTask = '转折期：晋升/转型/家庭重大决策'
  } else {
    generation = '泛90前'
    lifeTask = '转型期：第二曲线与家庭平衡'
  }
  return { birthYearMonth, generation, lifeTask }
}

// 暗层判定用户是逻辑型还是结果型（信号弱时保持原值）
export function personaSignal(text) {
  const t = String(text || '')
  const logical = /为什么|原理|逻辑|底层|规律|机制|认知|依据/.test(t)
  const result = /怎么办|该不该|要不要|直接|告诉我|结果|说重点/.test(t)
  if (logical && !result) return 'logical'
  if (result && !logical) return 'result'
  return null
}

// 黄道星座（用于注册页的"星图起点"与背景环；明面只说星座，与命理无关）
const SIGN_TABLE = [
  { name: '摩羯', symbol: '♑', from: [12, 22], to: [1, 19] },
  { name: '水瓶', symbol: '♒', from: [1, 20], to: [2, 18] },
  { name: '双鱼', symbol: '♓', from: [2, 19], to: [3, 20] },
  { name: '白羊', symbol: '♈', from: [3, 21], to: [4, 19] },
  { name: '金牛', symbol: '♉', from: [4, 20], to: [5, 20] },
  { name: '双子', symbol: '♊', from: [5, 21], to: [6, 21] },
  { name: '巨蟹', symbol: '♋', from: [6, 22], to: [7, 22] },
  { name: '狮子', symbol: '♌', from: [7, 23], to: [8, 22] },
  { name: '处女', symbol: '♍', from: [8, 23], to: [9, 22] },
  { name: '天秤', symbol: '♎', from: [9, 23], to: [10, 23] },
  { name: '天蝎', symbol: '♏', from: [10, 24], to: [11, 22] },
  { name: '射手', symbol: '♐', from: [11, 23], to: [12, 21] },
]

export const SIGNS = SIGN_TABLE.map((s) => ({ name: s.name, symbol: s.symbol }))

// 输入 "2001-09" 或 "2001-09-15" 或 "09-15"，返回 {name, symbol} 或 null
export function starSignFor(birth) {
  const m = String(birth || '').match(/(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const inRange = (s) => {
    if (s.from[0] === 12 && s.to[0] === 1) {
      return (month === 12 && day >= s.from[1]) || (month === 1 && day <= s.to[1])
    }
    return (month === s.from[0] && day >= s.from[1]) || (month === s.to[0] && day <= s.to[1])
  }
  const hit = SIGN_TABLE.find(inRange)
  return hit ? { name: hit.name, symbol: hit.symbol } : null
}
