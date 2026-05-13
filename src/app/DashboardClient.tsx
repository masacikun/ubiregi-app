'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'
import { STORES, ALL_LABEL } from '@/lib/stores'

type DowEntry   = { dow: number; label: string; total: number; count: number }
type HodEntry   = { hour: number; total: number; count: number }
type Day30Entry = { date: string; total: number; count: number }
type TopItem    = { name: string; category: string; revenue: number; quantity: number }

type Props = {
  monthDaily:      Record<string, unknown>[]
  yearMonthly:     Record<string, unknown>[]
  paymentData:     { name: string; amount: number }[]
  dowData:         DowEntry[]
  hodData:         HodEntry[]
  last30Days:      Day30Entry[]
  topItems:        TopItem[]
  topItemsTotal:   number
  periodTotal:     number
  periodCount:     number
  periodDiscount:  number
  prevTotal:       number
  prevYearTotal:   number
  momRevenue:      number | null
  yoyRevenue:      number | null
  momCount:        number | null
  avgCheckout:     number
  momAvg:          number | null
  yearCumulative:  number
  yoyLast30:       number | null
  bestDay:         { date: string; total: number } | null
  selectedYear:    number
  selectedMonth:   number
  availableYears:  number[]
  currentA:        string
  jstToday:        string
}

const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
const DOW_COLORS = ['text-red-500','text-slate-500','text-slate-500','text-slate-500','text-slate-500','text-slate-500','text-blue-500']

const CATEGORY_TABS = [
  { key: 'all',    label: '全商品' },
  { key: 'course', label: 'コース' },
  { key: 'drink',  label: 'ドリンク' },
  { key: 'food',   label: 'フード' },
  { key: 'other',  label: 'その他' },
] as const
type TabKey = typeof CATEGORY_TABS[number]['key']

function classifyCategory(cat: string): TabKey {
  if (!cat || cat === '--') return 'other'
  if (/コース/i.test(cat)) return 'course'
  if (/ドリンク|ビール|サワー|日本酒|梅酒|果実酒|ウイスキー|焼酎|カクテル|ワイン|ハイボール|チューハイ|酎ハイ|ソフトドリンク|ジュース|お茶|コーヒー|紅茶|ウーロン|飲料/i.test(cat)) return 'drink'
  if (/サービス料|割引|Uber|DiDi|出前館|Panda|FD|デリバリー/i.test(cat)) return 'other'
  return 'food'
}

// 17時〜翌1時（25時）
const HOD_RANGE  = [17, 18, 19, 20, 21, 22, 23, 0, 1]
const HOD_LABELS = ['17', '18', '19', '20', '21', '22', '23', '0', '1']

function yen(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}
function trendBadge(n: number | null) {
  if (n == null) return null
  return { up: n >= 0, str: `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(1)}%` }
}

function KpiCard({
  label, value, sub,
  trend1, trend1Label,
  trend2, trend2Label,
}: {
  label: string; value: string; sub?: string
  trend1?: number | null; trend1Label?: string
  trend2?: number | null; trend2Label?: string
}) {
  const t1 = trendBadge(trend1 ?? null)
  const t2 = trendBadge(trend2 ?? null)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
      {t1 && <p className={`text-xs font-semibold ${t1.up ? 'text-emerald-600' : 'text-red-500'}`}>{t1.str} {trend1Label}</p>}
      {t2 && <p className={`text-xs font-semibold ${t2.up ? 'text-blue-600' : 'text-slate-400'}`}>{t2.str} {trend2Label}</p>}
    </div>
  )
}

export default function DashboardClient({
  monthDaily, yearMonthly, paymentData, dowData, hodData,
  last30Days, topItems, topItemsTotal,
  periodTotal, periodCount, periodDiscount, prevTotal, prevYearTotal,
  momRevenue, yoyRevenue, momCount, avgCheckout, momAvg,
  yearCumulative, yoyLast30, bestDay,
  selectedYear, selectedMonth, availableYears, currentA, jstToday,
}: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [topTab, setTopTab] = useState<TabKey>('all')

  const storeOptions = [
    { id: 'all', label: ALL_LABEL },
    ...STORES.map(s => ({ id: String(s.id), label: s.label })),
  ]

  function nav(overrides: Record<string, string>) {
    const p = new URLSearchParams({ a: currentA, y: String(selectedYear), m: String(selectedMonth) })
    Object.entries(overrides).forEach(([k, v]) => p.set(k, v))
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }

  const max30     = Math.max(...last30Days.map(d => d.total), 1)
  const chartMax  = Math.max(...yearMonthly.map(r => Number(r.total ?? 0)), 1)
  const totalPayment = paymentData.reduce((s, p) => s + p.amount, 0)
  const maxDow    = Math.max(...dowData.map(d => d.total), 1)

  // 17〜25時フィルタ
  const filteredHod = HOD_RANGE.map(h => hodData.find(d => d.hour === h) ?? { hour: h, total: 0, count: 0 })
  const maxHod = Math.max(...filteredHod.map(h => h.total), 1)

  const monthlyRows = [...yearMonthly].sort((a, b) =>
    String(b.sale_month).localeCompare(String(a.sale_month))
  )

  // カテゴリタブフィルタ
  const filteredItems = topTab === 'all'
    ? topItems
    : topItems.filter(item => classifyCategory(item.category) === topTab)
  const displayItems  = filteredItems.slice(0, 10)
  const filteredTotal = filteredItems.reduce((s, i) => s + i.revenue, 0)

  const bestDayStr = bestDay
    ? new Date(bestDay.date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    : null

  return (
    <div className={`max-w-6xl mx-auto space-y-6 transition-opacity duration-150 ${isPending ? 'opacity-50 pointer-events-none' : ''}`}>

      {/* 店舗 + 期間選択 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">ダッシュボード</h1>
            <p className="text-sm text-slate-400 mt-0.5">{selectedYear}年{selectedMonth}月</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {storeOptions.map(s => (
              <button key={s.id} onClick={() => nav({ a: s.id })} disabled={isPending}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  currentA === s.id ? 'bg-blue-600 text-white shadow-md shadow-blue-100' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-slate-200'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-5 flex-wrap">
          <select value={selectedYear} onChange={e => nav({ y: e.target.value, m: String(selectedMonth) })}
            disabled={isPending}
            className="text-sm bg-white border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400">
            {availableYears.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={selectedMonth} onChange={e => nav({ m: e.target.value })}
            disabled={isPending}
            className="text-sm bg-white border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400">
            {MONTHS.map((label, i) => <option key={i + 1} value={i + 1}>{label}</option>)}
          </select>
          {isPending && (
            <span className="flex items-center gap-1.5 text-xs text-blue-500">
              <span className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin inline-block" />
              読み込み中…
            </span>
          )}
        </div>
      </div>

      {/* KPI 6枚 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard label="今月売上" value={yen(periodTotal)}
          trend1={momRevenue} trend1Label="前月比" trend2={yoyRevenue} trend2Label="前年同月比" />
        <KpiCard label="今月会計数" value={`${periodCount.toLocaleString()} 件`}
          trend1={momCount} trend1Label="前月比" />
        <KpiCard label="客単価" value={yen(avgCheckout)} trend1={momAvg} trend1Label="前月比" />
        <KpiCard label="値引き合計" value={yen(periodDiscount)}
          sub={periodTotal > 0 ? `売上比 ${((periodDiscount / periodTotal) * 100).toFixed(1)}%` : undefined} />
        <KpiCard label={`${selectedYear}年度 累計売上`} value={yen(yearCumulative)}
          sub={`${selectedYear}年1月〜${selectedMonth}月`} />
        <KpiCard label="最高売上日" value={bestDay ? yen(bestDay.total) : '—'}
          sub={bestDayStr ?? undefined} />
      </div>

      {/* 直近30日 日別売上（昨対比バッジ付き） */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 flex items-center gap-2">
            直近30日 日別売上
            {yoyLast30 != null && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                yoyLast30 >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
              }`}>
                昨年同期比 {yoyLast30 >= 0 ? '▲' : '▼'} {Math.abs(yoyLast30).toFixed(1)}%
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />日</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" />土</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-400 inline-block" />平日</span>
          </div>
        </div>
        <div className="flex items-end gap-px" style={{ height: '180px' }}>
          {last30Days.map(d => {
            const pct     = (d.total / max30) * 100
            const dt      = new Date(d.date + 'T00:00:00')
            const dow     = dt.getDay()
            const isSun   = dow === 0; const isSat = dow === 6
            const barColor   = isSun ? 'bg-red-400 hover:bg-red-500' : isSat ? 'bg-blue-400 hover:bg-blue-500' : 'bg-slate-400 hover:bg-slate-500'
            const labelColor = isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-slate-400'
            const dayNum  = dt.getDate()
            const showLabel = dayNum === 1 || dayNum % 5 === 0
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center relative group" style={{ minWidth: 0 }}>
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white rounded-lg px-2.5 py-2 whitespace-nowrap pointer-events-none z-20 text-xs shadow-lg">
                  <div className="font-semibold mb-1">{d.date.slice(5).replace('-', '/')}</div>
                  <div>売上: {yen(d.total)}</div><div>件数: {d.count}件</div>
                  {d.count > 0 && <div>客単価: {yen(Math.round(d.total / d.count))}</div>}
                </div>
                <div style={{ height: '20px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', width: '100%' }}>
                  {d.total > 0 && (
                    <span className="text-gray-600 dark:text-gray-400 tabular-nums leading-none" style={{ fontSize: '7px' }}>
                      {d.total >= 10000 ? `${Math.round(d.total / 10000)}万` : `${Math.round(d.total / 1000)}千`}
                    </span>
                  )}
                </div>
                <div className="w-full flex flex-col justify-end" style={{ height: '140px' }}>
                  <div className={`w-full rounded-t transition-all cursor-pointer ${barColor}`}
                    style={{ height: `${Math.max(pct, d.total > 0 ? 1.5 : 0)}%` }} />
                </div>
                <div style={{ height: '16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', width: '100%' }}>
                  {showLabel && <span className={`tabular-nums leading-none ${labelColor}`} style={{ fontSize: '7px' }}>{d.date.slice(5).replace('-', '/')}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 月別売上推移 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">{selectedYear}年 月別売上推移</h2>
        {yearMonthly.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
        ) : (
          <div className="flex items-end gap-1 relative" style={{ height: '160px' }}>
            {yearMonthly.map(m => {
              const pct   = (Number(m.total) / chartMax) * 100
              const label = new Date(String(m.sale_month) + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short' })
              const avg   = Number(m.checkout_count) > 0 ? Math.round(Number(m.total) / Number(m.checkout_count)) : 0
              return (
                <div key={String(m.sale_month)} className="flex-1 flex flex-col items-center gap-0.5 group relative" style={{ minWidth: 0 }}>
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white rounded-lg px-2.5 py-2 whitespace-nowrap pointer-events-none z-20 text-xs shadow-lg">
                    <div className="font-semibold mb-1">{label}</div>
                    <div>売上: {yen(Number(m.total))}</div>
                    <div>会計数: {Number(m.checkout_count).toLocaleString()}件</div>
                    <div>客単価: {yen(avg)}</div>
                  </div>
                  <span className="text-gray-500 dark:text-gray-400 tabular-nums" style={{ fontSize: '8px' }}>
                    {Number(m.total) >= 1000000 ? `${(Number(m.total) / 10000).toFixed(0)}万` : Number(m.total) > 0 ? `${Math.round(Number(m.total) / 1000)}千` : ''}
                  </span>
                  <div className="w-full flex items-end" style={{ height: '120px' }}>
                    <div className="w-full bg-blue-400 group-hover:bg-blue-600 rounded-t transition-all"
                      style={{ height: `${Math.max(pct, Number(m.total) > 0 ? 1 : 0)}%` }} />
                  </div>
                  <span className="text-slate-400" style={{ fontSize: '10px' }}>{label}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* 月別テーブル */}
        {monthlyRows.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-xs text-slate-400 font-medium">月</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">売上</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">前月比</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">会計数</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">客単価</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium hidden sm:table-cell">値引き</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((row, idx) => {
                  const prev = monthlyRows[idx + 1]
                  const mom  = prev && Number(prev.total) > 0
                    ? ((Number(row.total) - Number(prev.total)) / Number(prev.total)) * 100 : null
                  const avg  = Number(row.checkout_count) > 0
                    ? Math.round(Number(row.total) / Number(row.checkout_count)) : 0
                  return (
                    <tr key={String(row.sale_month)} className="border-b border-slate-50 hover:bg-gray-50 dark:bg-gray-800">
                      <td className="py-2 text-gray-600 dark:text-gray-400 text-sm">
                        {new Date(String(row.sale_month) + 'T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}
                      </td>
                      <td className="py-2 text-right font-semibold text-gray-700 dark:text-gray-300 tabular-nums">{yen(Number(row.total))}</td>
                      <td className="py-2 text-right">
                        {mom != null
                          ? <span className={`text-xs font-semibold ${mom >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{mom >= 0 ? '+' : ''}{mom.toFixed(1)}%</span>
                          : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="py-2 text-right text-gray-500 dark:text-gray-400 tabular-nums">{Number(row.checkout_count).toLocaleString()}</td>
                      <td className="py-2 text-right text-gray-500 dark:text-gray-400 tabular-nums">{yen(avg)}</td>
                      <td className="py-2 text-right text-red-400 tabular-nums hidden sm:table-cell">{yen(Number(row.discount_amount ?? 0))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 売上ランキング（カテゴリタブ付き） */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400">
            売上ランキング TOP10 <span className="ml-1 text-xs font-normal text-slate-400">（直近データ）</span>
          </h2>
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORY_TABS.map(tab => (
              <button key={tab.key} onClick={() => setTopTab(tab.key)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  topTab === tab.key ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 dark:text-gray-400 border-slate-300 hover:border-blue-400 hover:text-blue-600'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {displayItems.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-6">データがありません</p>
        ) : (
          <div className="space-y-2">
            {displayItems.map((item, i) => {
              const share = filteredTotal > 0 ? (item.revenue / filteredTotal) * 100 : 0
              const rankColors = ['bg-amber-400', 'bg-slate-300', 'bg-orange-300']
              return (
                <div key={i} className="flex items-center gap-3 group">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${i < 3 ? rankColors[i] : 'bg-slate-200 text-slate-500'}`}>
                    {i + 1}
                  </span>
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">{item.name || '（名称不明）'}</span>
                  <span className="text-xs text-slate-400 hidden sm:block w-24 truncate text-right">{item.category || '—'}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-16 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(share, 100)}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 w-10 text-right tabular-nums">{share.toFixed(1)}%</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-24 text-right shrink-0 tabular-nums">{yen(item.revenue)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 曜日別 + 時間帯別（17〜25時） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">曜日別売上 <span className="text-xs font-normal text-slate-400">（直近30日）</span></h2>
          {dowData.every(d => d.total === 0) ? (
            <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
          ) : (
            <div className="space-y-2">
              {dowData.map(d => (
                <div key={d.dow} className="flex items-center gap-2 group" title={`${d.label}曜日: ${yen(d.total)} / ${d.count}件`}>
                  <span className={`text-sm font-bold w-5 shrink-0 ${DOW_COLORS[d.dow]}`}>{d.label}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-3.5 overflow-hidden">
                    <div className="h-full bg-blue-400 group-hover:bg-blue-500 rounded-full transition-all" style={{ width: `${(d.total / maxDow) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-24 text-right shrink-0 tabular-nums">{yen(d.total)}</span>
                  <span className="text-xs text-slate-400 w-10 text-right shrink-0">{d.count}件</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">
            時間帯別売上
            <span className="text-xs font-normal text-slate-400 ml-1">17〜翌1時（直近30日）</span>
          </h2>
          {filteredHod.every(h => h.total === 0) ? (
            <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
          ) : (
            <div className="flex items-end gap-1 h-32">
              {filteredHod.map((h, idx) => {
                const p = (h.total / maxHod) * 100
                return (
                  <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5 group"
                    title={`${HOD_LABELS[idx]}時: ${yen(h.total)} / ${h.count}件`}>
                    <div className="w-full flex items-end" style={{ height: '80px' }}>
                      <div className={`w-full rounded-t transition-all ${h.count > 0 ? 'bg-amber-400 group-hover:bg-amber-500' : 'bg-slate-100'}`}
                        style={{ height: `${Math.max(p, h.count > 0 ? 2 : 0)}%` }} />
                    </div>
                    <span className="text-slate-400" style={{ fontSize: '9px' }}>{HOD_LABELS[idx]}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 支払方法別 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">支払方法別</h2>
        {paymentData.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
        ) : (
          <div className="space-y-2.5">
            {paymentData.map(p => {
              const pct = totalPayment > 0 ? (p.amount / totalPayment) * 100 : 0
              return (
                <div key={p.name} className="flex items-center gap-3 group">
                  <span className="text-xs text-gray-600 dark:text-gray-400 w-32 shrink-0 truncate">{p.name}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
                    <div className="h-full bg-emerald-400 group-hover:bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-24 text-right shrink-0 tabular-nums">{yen(p.amount)}</span>
                  <span className="text-xs text-slate-400 w-10 text-right shrink-0">{pct.toFixed(0)}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
