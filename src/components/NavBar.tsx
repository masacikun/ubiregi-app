'use client'

import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { storeOptionsFor, type StoreInfo } from '@/lib/stores'

const EXTERNAL_LINKS = [
  { href: 'https://banto.hakata-yamato.co.jp/card', label: '名刺' },
  { href: 'https://banto.hakata-yamato.co.jp/n',           label: '電話履歴' },
  { href: 'https://banto.hakata-yamato.co.jp/',            label: '予実管理' },
  { href: 'https://banto.hakata-yamato.co.jp/m', label: 'MF会計'  },
  { href: 'https://banto.hakata-yamato.co.jp/a',            label: '分析'     },
  { href: 'https://banto.hakata-yamato.co.jp/master',       label: '店舗マスタ' },
  { href: 'https://banto.hakata-yamato.co.jp/sq', label: 'Square' },
  { href: 'https://banto.hakata-yamato.co.jp/car', label: '車' },
  { href: 'https://banto.hakata-yamato.co.jp/eigyo', label: '営業カレンダー' },
]

const links = [
  { href: '/',      label: 'ダッシュボード' },
  { href: '/sales', label: '売上分析' },
  { href: '/items', label: '商品分析' },
  { href: '/mf-send', label: 'MF送信' },
]

export default function NavBar({ stores }: { stores: StoreInfo[] }) {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const [navigating, setNavigating] = useState(false)

  useEffect(() => { setNavigating(false) }, [pathname, searchParams])

  const currentA = searchParams.get('a') ?? 'all'
  const currentY = searchParams.get('y') ?? ''
  // ダッシュボードはページ内タブ、過去店舗は一覧ページのため共通セレクタは出さない
  const hideSelector = pathname === '/' || pathname === '/past-stores'

  const storeOptions = storeOptionsFor(stores, currentA)

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
        <Link href={makeHref('/')} className="flex items-center gap-2 font-bold text-base tracking-wide text-white hover:text-slate-200 transition-colors">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/u/logo.svg" alt="番頭さん" className="w-6 h-6 rounded-full" />ユビレジ分析
        </Link>
        <div className="flex items-center gap-3">
          {!hideSelector && (
            <select
              value={currentA}
              onChange={handleStoreChange}
              className="text-xs bg-slate-700 border border-slate-600 text-white rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {storeOptions.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
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
            <Link
              href="/past-stores"
              onClick={() => pathname !== '/past-stores' && setNavigating(true)}
              className={`px-3 py-2 rounded text-xs font-semibold transition-colors ${
                pathname === '/past-stores'
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              過去店舗
            </Link>
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
