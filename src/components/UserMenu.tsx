'use client'

import { useEffect, useState } from 'react'

type Me = { email: string; role: string; display_name: string }

// 現在ユーザー表示＋管理リンク（adminのみ）＋ログアウト。
// /auth/api/me を1回だけ取得して3要素に使い回す。取得失敗時はユーザー名/管理リンクを出さない（ボタンは常時）。
// ログアウトは POST（GETリンクだと prefetch 誤爆の恐れがあるため button）
export default function UserMenu() {
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/auth/api/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.email) setMe(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const logout = async () => {
    try { await fetch('/auth/api/logout', { method: 'POST' }) } catch {}
    window.location.href = '/login'
  }

  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {me && (
        <span className="text-xs text-slate-400 whitespace-nowrap" title={me.display_name}>
          {me.email}
        </span>
      )}
      {me?.role === 'admin' && (
        <a href="/admin"
          className="px-2.5 py-1.5 rounded text-xs font-semibold text-purple-300 border border-purple-700 hover:bg-purple-700 hover:text-white transition-colors whitespace-nowrap">
          管理
        </a>
      )}
      <button onClick={logout}
        className="px-2.5 py-1.5 rounded text-xs font-semibold text-slate-400 border border-slate-600 hover:bg-slate-700 hover:text-white transition-colors whitespace-nowrap">
        ログアウト
      </button>
    </span>
  )
}
