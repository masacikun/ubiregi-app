'use client'

import { DailySales, ItemSalesRanking } from '@/lib/types'

type Props = {
  dailySales: DailySales[]
  thisMonthTotal: number
  thisMonthCount: number
  thisMonthDiscount: number
  momRate: number | null
  topItems: ItemSalesRanking[]
}

function fmt(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}

function KpiCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: number | null }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      {trend != null && (
        <p className={`text-xs font-semibold mt-1 ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}% 前月比
        </p>
      )}
    </div>
  )
}

export default function DashboardClient({ dailySales, thisMonthTotal, thisMonthCount, thisMonthDiscount, momRate, topItems }: Props) {
  const avgCheckout = thisMonthCount > 0 ? thisMonthTotal / thisMonthCount : 0

  // バーチャートの最大値
  const maxSales = Math.max(...dailySales.map(d => d.total), 1)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-700">ダッシュボード</h1>

      {/* KPIカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="今月売上"
          value={fmt(thisMonthTotal)}
          trend={momRate}
        />
        <KpiCard
          label="今月会計数"
          value={`${thisMonthCount.toLocaleString()} 件`}
        />
        <KpiCard
          label="客単価"
          value={fmt(Math.round(avgCheckout))}
          sub="今月平均"
        />
        <KpiCard
          label="値引き合計"
          value={fmt(thisMonthDiscount)}
          sub="今月"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 直近30日 売上グラフ */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-bold text-slate-600 mb-4">直近30日 日別売上</h2>
          {dailySales.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
          ) : (
            <div className="space-y-1">
              {dailySales.map(d => {
                const pct = (d.total / maxSales) * 100
                const dateStr = new Date(d.sale_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                return (
                  <div key={d.sale_date} className="flex items-center gap-2 group">
                    <span className="text-xs text-slate-400 w-10 text-right shrink-0">{dateStr}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 group-hover:bg-blue-600 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-600 w-20 text-right shrink-0">
                      {(d.total / 10000).toFixed(1)}万
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 商品ランキング TOP5 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-bold text-slate-600 mb-4">売上ランキング TOP5</h2>
          {topItems.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
          ) : (
            <div className="space-y-3">
              {topItems.map((item, i) => (
                <div key={item.menu_item_name} className="flex items-center gap-3">
                  <span className={`text-lg font-black w-6 text-center ${
                    i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : 'text-slate-300'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{item.menu_item_name}</p>
                    <p className="text-xs text-slate-400">{item.category_name ?? '―'} ／ {item.total_quantity}点</p>
                  </div>
                  <span className="text-sm font-bold text-slate-700 shrink-0">{fmt(item.total_revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
