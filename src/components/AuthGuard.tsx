'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { track } from '@/lib/presence'

const HEARTBEAT_MS = Number(process.env.NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS) || 30000

// セッション失効時の 401 自動遷移 ＋ 在席 presence heartbeat。
// layout.tsx の <body> 内に <AuthGuard /> を1行置くだけで有効になる。
export default function AuthGuard() {
  const pathname = usePathname()

  // 401 自動遷移: nginx が失効セッションの fetch を /login へ 302 させるので、
  // 「ログイン画面へ redirect 追従した fetch」を検知したらページ全体を /login へ遷移する。
  // /auth/api/presence の 401 は redirect されない（redirected=false）ため誤発火しない。
  useEffect(() => {
    const w = window as Window & { __authGuardPatched?: boolean }
    if (w.__authGuardPatched) return // StrictMode/HMR での二重ラップ防止
    w.__authGuardPatched = true
    const orig = window.fetch.bind(window)
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await orig(...args)
      try {
        if (res.redirected) {
          const p = new URL(res.url).pathname
          const isLogin = p === '/login' || p === '/auth/login'
          const onLogin = window.location.pathname === '/login' || window.location.pathname === '/auth/login'
          if (isLogin && !onLogin) {
            // redirect= は API パスでなく「今見ているページのURL」
            const here = window.location.pathname + window.location.search
            window.location.href = '/login?redirect=' + encodeURIComponent(here)
          }
        }
      } catch {
        // 検知失敗時は何もしない（res は必ずそのまま返す）
      }
      return res
    }
  }, [])

  // ページ遷移ごとに track（location.pathname は basePath 込みの公開パス）
  useEffect(() => {
    track(window.location.pathname)
  }, [pathname])

  // 可視タブのみ heartbeat（間隔は NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS・default 30s）＋可視化時に1発
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === 'visible') track(window.location.pathname)
    }
    const timer = setInterval(beat, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', beat)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [])

  return null
}
