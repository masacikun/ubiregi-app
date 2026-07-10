'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { upsertCategoryClassAction, setProductOverrideAction, type SaveResult } from './actions'

export type SalesClass = 'food' | 'drink' | 'other'
export type StoreTab = { accountId: number; label: string }
export type CategoryRow = {
  categoryName: string
  salesClass: SalesClass | null // null = 実売にあるが category_map 未登録
  memo: string | null
  productCount: number
  unmapped: boolean
}
export type ProductRow = {
  menuItemId: number
  name: string
  categoryName: string | null
  defaultClass: SalesClass | null // カテゴリ由来の既定（null = 未マッピング → 生成時 other + 要確認）
  override: SalesClass | null
  note: string | null
  qty: number
  subtotal: number
}

const CLASS_JA: Record<SalesClass, string> = { food: 'フード', drink: 'ドリンク', other: 'その他' }
const CLASS_STYLE: Record<SalesClass, string> = {
  food: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  drink: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  other: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

function ClassBadge({ cls }: { cls: SalesClass | null }) {
  if (cls === null) {
    return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">未マッピング</span>
  }
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CLASS_STYLE[cls]}`}>{CLASS_JA[cls]}</span>
}

function yen(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}

const selectCls = 'text-xs border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50'

export default function SalesClassClient({ tabs, accountId, categories, products }: {
  tabs: StoreTab[]
  accountId: number
  categories: CategoryRow[]
  products: ProductRow[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<SaveResult | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState<Record<number, string>>({})

  function run(key: string, fn: () => Promise<SaveResult>) {
    setSavingKey(key)
    setMessage(null)
    startTransition(async () => {
      const r = await fn()
      setMessage(r)
      setSavingKey(null)
      if (r.ok) router.refresh()
    })
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? products.filter(p => p.name.toLowerCase().includes(q) || (p.categoryName ?? '').toLowerCase().includes(q))
    : products
  const overriddenCount = products.filter(p => p.override !== null).length

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">売上区分マッピング</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          MF送信（売上高: フード/ドリンク/その他）の振り分け設定。優先順は
          <span className="font-medium"> ①商品オーバーライド → ②カテゴリ既定</span>。
          変更は次回のドラフト生成（毎日4:10）から反映され、<span className="font-medium">送信済みの日には影響しません</span>。
        </p>
      </div>

      {/* 店タブ */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {tabs.map(t => (
          <Link
            key={t.accountId}
            href={`/sales-class?a=${t.accountId}`}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              t.accountId === accountId
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {message && (
        <div className={`text-sm px-3 py-2 rounded ${message.ok
          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
          {message.message}
        </div>
      )}

      {/* セクションA: カテゴリ区分 */}
      <section className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">カテゴリ区分（既定）</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">ubiregi_category_map。商品数は直近90日に実売のあった商品の数。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-2 font-medium">カテゴリ</th>
                <th className="px-4 py-2 font-medium">区分</th>
                <th className="px-4 py-2 font-medium text-right">商品数</th>
                <th className="px-4 py-2 font-medium">メモ</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(c => {
                const key = `cat:${c.categoryName}`
                return (
                  <tr key={c.categoryName} className={`border-b border-gray-100 dark:border-gray-800 ${c.unmapped ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                    <td className="px-4 py-2 text-gray-900 dark:text-gray-100">
                      {c.categoryName}
                      {c.unmapped && <span className="ml-2 text-xs text-red-600 dark:text-red-400 font-medium">未登録（生成時は その他＋要確認）</span>}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        className={selectCls}
                        value={c.salesClass ?? ''}
                        disabled={isPending && savingKey === key}
                        onChange={e => run(key, () => upsertCategoryClassAction(accountId, c.categoryName, e.target.value))}
                      >
                        {c.salesClass === null && <option value="" disabled>選択…</option>}
                        <option value="food">フード</option>
                        <option value="drink">ドリンク</option>
                        <option value="other">その他</option>
                      </select>
                      {savingKey === key && <span className="ml-2 text-xs text-gray-400">保存中…</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{c.productCount}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{c.memo ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* セクションB: 商品オーバーライド */}
      <section className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">商品オーバーライド</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              直近90日に実売のあった商品（{products.length}件・上書き中 {overriddenCount}件）。カテゴリ既定と実態がズレる商品だけ個別に上書きする。
            </p>
          </div>
          <input
            type="search"
            placeholder="商品名・カテゴリで絞り込み（例: D1000）"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border rounded px-3 py-1.5 w-72 max-w-full bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-2 font-medium">商品名</th>
                <th className="px-4 py-2 font-medium">カテゴリ</th>
                <th className="px-4 py-2 font-medium">既定区分</th>
                <th className="px-4 py-2 font-medium">実効区分</th>
                <th className="px-4 py-2 font-medium">オーバーライド</th>
                <th className="px-4 py-2 font-medium">理由メモ</th>
                <th className="px-4 py-2 font-medium text-right">直近90日 税抜</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const key = `item:${p.menuItemId}`
                const effective: SalesClass = p.override ?? p.defaultClass ?? 'other'
                const noteValue = notes[p.menuItemId] ?? p.note ?? ''
                return (
                  <tr key={p.menuItemId} className={`border-b border-gray-100 dark:border-gray-800 ${p.override ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}>
                    <td className="px-4 py-2 text-gray-900 dark:text-gray-100">
                      {p.name}
                      {p.override && <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900 dark:bg-amber-700 dark:text-amber-100">上書き中</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{p.categoryName ?? '—'}</td>
                    <td className="px-4 py-2"><ClassBadge cls={p.defaultClass} /></td>
                    <td className="px-4 py-2"><ClassBadge cls={effective} /></td>
                    <td className="px-4 py-2">
                      <select
                        className={selectCls}
                        value={p.override ?? 'default'}
                        disabled={isPending && savingKey === key}
                        onChange={e => run(key, () => setProductOverrideAction(accountId, p.menuItemId, p.name, p.categoryName, e.target.value, noteValue))}
                      >
                        <option value="default">既定に従う</option>
                        <option value="food">フード</option>
                        <option value="drink">ドリンク</option>
                        <option value="other">その他</option>
                      </select>
                      {savingKey === key && <span className="ml-2 text-xs text-gray-400">保存中…</span>}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        placeholder={p.override ? '例: 飲み放題プラン' : ''}
                        value={noteValue}
                        disabled={!p.override}
                        onChange={e => setNotes(n => ({ ...n, [p.menuItemId]: e.target.value }))}
                        onBlur={e => {
                          if (p.override && e.target.value.trim() !== (p.note ?? '')) {
                            run(key, () => setProductOverrideAction(accountId, p.menuItemId, p.name, p.categoryName, p.override as string, e.target.value))
                          }
                        }}
                        className="text-xs border rounded px-2 py-1 w-40 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{yen(p.subtotal)}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">該当する商品がありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
