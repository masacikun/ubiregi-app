// 在席 presence heartbeat（送信先 /auth/api/presence は slide しない = idle 2h を延命しない）
// 失敗は握り潰す: presence が本体機能や 401 遷移に影響してはならない
export function track(path: string, eventType = 'pageview', meta: Record<string, unknown> = {}) {
  try {
    fetch('/auth/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, event_type: eventType, meta }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // noop
  }
}
