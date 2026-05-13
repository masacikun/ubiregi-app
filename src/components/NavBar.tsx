'use client'

import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { STORES, ALL_LABEL, DEFAULT_ACCOUNT_ID } from '@/lib/stores'

const EXTERNAL_LINKS = [
  { href: '/n',           label: '電話履歴' },
  { href: '/',            label: '予実管理' },
  { href: '/m/dashboard', label: 'MF会計'  },
]

const links = [
  { href: '/',      label: 'ダッシュボード' },
  { href: '/sales', label: '売上分析' },
  { href: '/items', label: '商品分析' },
]

export default function NavBar() {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const [navigating, setNavigating] = useState(false)

  useEffect(() => { setNavigating(false) }, [pathname, searchParams])

  const currentA = searchParams.get('a') ?? String(DEFAULT_ACCOUNT_ID)
  const currentY = searchParams.get('y') ?? ''
  const isDashboard = pathname === '/'

  function buildParams(overrides: Record<string, string | null> = {}) {
    const p = new URLSearchParams()
    p.set('a', overrides.a ?? currentA)
    const y = overrides.y !== undefined ? overrides.y : currentY
    if (y) p.set('y', y)
    return p.toString()
  }

  function makeHref(path: string) {
    return `${path}?${buildParams()}`
  }

  function handleStoreChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setNavigating(true)
    router.push(`${pathname}?${buildParams({ a: e.target.value })}`)
  }

  return (
    <header className="relative bg-slate-900 text-white shadow-lg">
      {navigating && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-400 animate-pulse z-50" />
      )}
      <div className="w-full px-4 flex items-center justify-between h-14">
        <Link href={makeHref('/')} className="font-bold text-base tracking-wide text-white hover:text-slate-200 transition-colors">
          ユビレジ分析
        </Link>
        <div className="flex items-center gap-3">
          {!isDashboard && (
            <select
              value={currentA}
              onChange={handleStoreChange}
              className="text-xs bg-slate-700 border border-slate-600 text-white rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">{ALL_LABEL}</option>
              {STORES.map(s => (
                <option key={s.id} value={String(s.id)}>{s.label}</option>
              ))}
            </select>
          )}
          <nav className="flex items-center gap-0.5">
            {links.map(link => (
              <Link
                key={link.href}
                href={makeHref(link.href)}
                onClick={() => pathname !== link.href && setNavigating(true)}
                className={`px-3 py-2 rounded text-sm font-semibold transition-colors ${
                  pathname === link.href
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-200 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="ml-2 flex items-center gap-1.5 border-l border-slate-600 pl-3">
              {EXTERNAL_LINKS.map(link => (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-3 py-1.5 rounded text-xs font-semibold text-sky-300 border border-sky-700 hover:bg-sky-700 hover:text-white transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </header>
  )
}
