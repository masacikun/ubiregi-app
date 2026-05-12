'use client'

import { DailySales, ItemSalesRanking } from '@/lib/types'

type Props = {
  dailySales: DailySales[]
  thisMonthTotal: number
  thisMonthCount: number
  thisMonthDiscount: number
  momRate: number | null
  topItems: ItemSalesRanking[]
  thisMonthSaleDate: string
}

function yen(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}

function KpiCard({
  label, value, sub, trend,
}: {
  label: string; value: string; sub?: string; trend?: number | null
}) {
  const trendColor = trend == null ? '' : trend >= 0 ? 'text-emerald-600' : 'text-red-500'
  const trendIcon  = trend == null ? '' : trend >= 0 ? '▲' : '▼'
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex flex-col gap-1">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
      {trend != null && (
        <p className={`text-xs font-semibold ${trendColor}`}>
          {trendIcon} {Math.abs(trend).toFixed(1)}% 前月比
        </p>
      )}
    </div>
  )
}

export default function DashboardClient({
  dailySales, thisMonthTotal, thisMonthCount, thisMonthDiscount,
  momRate, topItems, thisMonthSaleDate,
}: Props) {
  const avgCheckout = thisMonthCount > 0 ? thisMonthTotal / thisMonthCount : 0
  const maxSales    = Math.max(...dailySales.map(d => d.total), 1)

  const monthLabel = thisMonthSaleDate
    ? new Date(thisMonthSaleDate + 'T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })
    : '今月'

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* ヘッダ */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">ダッシュボード</h1>
        <span className="text-sm text-slate-400 bg-white border border-slate-200 rounded-lg px-3 py-1">
          {monthLabel}
        </span>
      </div>

      {/* KPI カード */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="今月売上" value={yen(thisMonthTotal)} trend={momRate} />
        <KpiCard label="会計件数" value={`${thisMonthCount.toLocaleString()} 件`} />
        <KpiCard label="客単価"   value={yen(Math.round(avgCheckout))} sub="今月平均" />
        <KpiCard label="値引き"   value={yen(thisMonthDiscount)} sub="今月合計" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 日別売上バーチャート */}
        <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-sm font-bold text-slate-600 mb-5">直近30日 日別売上</h2>
          {dailySales.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-12">データがありません</p>
          ) : (
            <div className="space-y-1.5">
              {dailySales.map(d => {
                const pct = (d.total / maxSales) * 100
                const dateStr = new Date(d.sale_date + 'T00:00:00')
                  .toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                return (
                  <div key={d.sale_date} className="flex items-center gap-3 group">
                    <span className="text-xs text-slate-400 w-10 text-right shrink-0 tabular-nums">{dateStr}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-3.5 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 group-hover:bg-blue-600 rounded-full transition-all duration-200"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-slate-600 w-16 text-right shrink-0 tabular-nums">
                      {(d.total / 10000).toFixed(1)}万
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 売上ランキング TOP5 */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-sm font-bold text-slate-600 mb-5">売上ランキング TOP5</h2>
          {topItems.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-12">データがありません</p>
          ) : (
            <ol className="space-y-4">
              {topItems.map((item, i) => {
                const medals = ['🥇', '🥈', '🥉']
                const rankIcon = medals[i] ?? `${i + 1}`
                return (
                  <li key={`${item.menu_item_id}-${i}`} className="flex items-start gap-3">
                    <span className="text-xl w-7 shrink-0 leading-none mt-0.5">{rankIcon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate leading-snug">
                        {item.menu_item_name || '（名称不明）'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {item.category_name ?? '—'} · {Number(item.total_quantity).toLocaleString()}点
                      </p>
                    </div>
                    <span className="text-sm font-bold text-slate-700 shrink-0 tabular-nums">
                      {yen(Number(item.total_revenue))}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
