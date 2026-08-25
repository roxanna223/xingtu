import { getSessionUser } from './auth'
import { findUserByUsername, trackEvent } from './store'

/**
 * 服务端埋点(方案 docs/15 §埋点):
 *  - 解析会话 → 写 events 表(匿名请求 user_id=NULL)
 *  - **管理员(role=admin)的操作一律不写入**
 *  - 任何异常静默吞掉,埋点永不阻塞业务
 */
export function trackReq(req, event, path = '', detail = null) {
  try {
    const username = getSessionUser(req)
    if (!username) {
      trackEvent(null, event, path, detail)
      return
    }
    const u = findUserByUsername(username)
    if (!u || u.role === 'admin') return
    trackEvent(u.id, event, path, detail)
  } catch {
    // 忽略埋点失败
  }
}
