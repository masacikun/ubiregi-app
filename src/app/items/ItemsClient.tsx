'use client'

import { useState } from 'react'
import { ItemSalesRanking } from '@/lib/types'

type CategorySales = {
  account_id: number
  category_id: number | null
  category_name: string | null
  checkout_count: number
  total_quantity: number
  total_revenue: number
}

type Props = {
  ranking: ItemSalesRanking[]
  categorySales: CategorySales[]
}

function fmt(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}

export default function ItemsClient({ ranking, categorySales }: Props) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  const categories = ['all', ...Array.from(new Set(ranking.map(r => r.category_name ?? '未分類')))]

  const filtered = ranking.filter(r => {
    const matchSearch = r.menu_item_name.includes(search)
    const matchCat = selectedCategory === 'all' || (r.category_name ?? '未分類') === selectedCategory
    return matchSearch && matchCat
  })

  const maxRevenue = Math.max(...categorySales.map(c => c.total_revenue), 1)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-700">商品分析</h1>

      {/* カテゴリ別売上 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-600 mb-4">カテゴリ別売上</h2>
        {categorySales.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-6">データがありません</p>
        ) : (
          <div className="space-y-2">
            {categorySales.map(c => {
              const pct = (c.total_revenue / maxRevenue) * 100
              return (
                <div key={c.category_id ?? 'none'} className="flex items-center gap-3">
                  <span
                    className="text-sm text-slate-600 w-32 shrink-0 truncate cursor-pointer hover:text-blue-600"
                    onClick={() => setSelectedCategory(c.category_name ?? '未分類')}
                  >
                    {c.category_name ?? '未分類'}
                  </span>
                  <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-violet-400 hover:bg-violet-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 w-24 text-right shrink-0">
                    {fmt(c.total_revenue)}
                  </span>
                  <span className="text-xs text-slate-400 w-14 text-right shrink-0">
                    {c.total_quantity.toLocaleString()}点
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 商品ランキング */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-slate-600">商品別ランキング</h2>
          <div className="flex gap-2 flex-wrap">
            {/* カテゴリフィルタ */}
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600"
            >
              {categories.map(c => (
                <option key={c} value={c}>{c === 'all' ? 'すべて' : c}</option>
              ))}
            </select>
            {/* 検索 */}
            <input
              type="text"
              placeholder="商品名で絞り込み"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-xs border border-slate-200 rounded px-3 py-1 text-slate-600 w-36"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 text-xs text-slate-400 font-medium w-8">#</th>
                <th className="text-left py-2 text-xs text-slate-400 font-medium">商品名</th>
                <th className="text-left py-2 text-xs text-slate-400 font-medium">カテゴリ</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">売上</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">数量</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">原価率</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                    該当する商品がありません
                  </td>
                </tr>
              ) : (
                filtered.map((item, i) => (
                  <tr key={item.menu_item_name} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-400 text-xs">{i + 1}</td>
                    <td className="py-2 text-slate-700 font-medium">{item.menu_item_name}</td>
                    <td className="py-2 text-slate-400 text-xs">{item.category_name ?? '―'}</td>
                    <td className="py-2 text-right font-semibold text-slate-700">{fmt(item.total_revenue)}</td>
                    <td className="py-2 text-right text-slate-500">{Number(item.total_quantity).toLocaleString()}</td>
                    <td className="py-2 text-right">
                      {item.cost_rate_pct != null ? (
                        <span className={`text-xs font-semibold ${
                          item.cost_rate_pct > 35 ? 'text-red-500' : 'text-emerald-600'
                        }`}>
                          {Number(item.cost_rate_pct).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">―</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
