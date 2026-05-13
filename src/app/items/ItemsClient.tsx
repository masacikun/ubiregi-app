'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { STORES, ALL_LABEL } from '@/lib/stores'

type RankingItem = {
  menu_item_id:   number | null
  menu_item_name: string
  category_id:    number | null
  category_name:  string | null
  total_quantity: number
  total_revenue:  number
}

type Props = {
  ranking:          RankingItem[]
  rowsFetched:      number
  isPeriodFiltered: boolean
  selectedFrom:     string | null
  selectedTo:       string | null
  currentA:         string
  pairingData:      { item1: string; item2: string; count: number }[]
  hodTopItems:      { hour: number; items: { name: string; quantity: number }[] }[]
  dowTopItems:      { dow: number; label: string; items: { name: string; quantity: number }[] }[]
  seasonalData:     { key: string; label: string; total: number; items: { name: string; rev: number }[] }[]
}

const DOW_COLORS_CLS = ['text-red-500','text-slate-600','text-slate-600','text-slate-600','text-slate-600','text-slate-600','text-blue-500']
const HOD_RANGE = [17,18,19,20,21,22,23,0,1]
const SEASON_COLORS: Record<string, string> = {
  spring: 'bg-pink-100 text-pink-700',
  summer: 'bg-sky-100 text-sky-700',
  fall:   'bg-amber-100 text-amber-700',
  winter: 'bg-slate-100 text-slate-600',
}
const DONUT_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#6366f1']

function yen(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}

function downloadCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const lines   = rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
  const blob    = new Blob(['﻿' + [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const ABC_COLORS = { A: 'bg-emerald-100 text-emerald-700', B: 'bg-amber-100 text-amber-700', C: 'bg-slate-100 text-slate-500' }

// SVGドーナツチャート
function DonutChart({ data, size = 128 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return null
  const cx = size / 2, cy = size / 2, R = size * 0.4, r = size * 0.24
  let angle = -Math.PI / 2
  const slices = data.map(d => {
    const a0 = angle
    const sweep = (d.value / total) * Math.PI * 2
    angle += sweep
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0)
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    const path  = sweep < 0.001 ? '' : `M${cx},${cy}L${x0.toFixed(1)},${y0.toFixed(1)}A${R},${R},0,${large},1,${x1.toFixed(1)},${y1.toFixed(1)}Z`
    return { ...d, path }
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.filter(s => s.path).map((s, i) => (
        <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth={2} />
      ))}
      <circle cx={cx} cy={cy} r={r} fill="white" />
    </svg>
  )
}

export default function ItemsClient({
  ranking, rowsFetched, isPeriodFiltered, selectedFrom, selectedTo, currentA,
  pairingData, hodTopItems, dowTopItems, seasonalData,
}: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const [search,      setSearch]      = useState('')
  const [selCategory, setSelCategory] = useState('all')
  const [sort,        setSort]        = useState<'revenue' | 'quantity'>('revenue')
  const [localFrom,   setLocalFrom]   = useState(selectedFrom ?? '')
  const [localTo,     setLocalTo]     = useState(selectedTo ?? '')
  const [activeHod,   setActiveHod]   = useState<number | null>(null)
  const [activeDow,   setActiveDow]   = useState<number | null>(null)

  const storeOptions = [
    { id: 'all', label: ALL_LABEL },
    ...STORES.map(s => ({ id: String(s.id), label: s.label })),
  ]

  function navigate(from: string | null, to: string | null, a?: string) {
    const p = new URLSearchParams({ a: a ?? currentA })
    if (from) p.set('from', from)
    if (to)   p.set('to', to)
    startTransition(() => router.push(`${pathname}?${p.toString()}`))
  }

  const today    = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const quickSelects = [
    { label: '今月',   from: todayStr.substring(0,7)+'-01', to: todayStr },
    { label: '先月',   from: (() => { const d=new Date(today.getFullYear(),today.getMonth()-1,1); return d.toISOString().split('T')[0] })(),
                       to:   (() => { const d=new Date(today.getFullYear(),today.getMonth(),0);   return d.toISOString().split('T')[0] })() },
    { label: '今年',   from: `${today.getFullYear()}-01-01`, to: todayStr },
    { label: '去年',   from: `${today.getFullYear()-1}-01-01`, to: `${today.getFullYear()-1}-12-31` },
    { label: '全期間', from: null, to: null },
  ]

  // カテゴリ集計
  const categoryStats = useMemo(() => {
    const map: Record<string, { amount: number; quantity: number }> = {}
    for (const r of ranking) {
      const cat = r.category_name ?? '未分類'
      if (!map[cat]) map[cat] = { amount: 0, quantity: 0 }
      map[cat].amount   += r.total_revenue
      map[cat].quantity += r.total_quantity
    }
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount)
  }, [ranking])

  const totalRevenue = categoryStats.reduce((s, c) => s + c.amount, 0)
  const maxCategory  = Math.max(...categoryStats.map(c => c.amount), 1)
  const categories   = ['all', ...categoryStats.map(c => c.name)]

  // ドーナツ用データ（上位8 + その他）
  const donutData = useMemo(() => {
    const top = categoryStats.slice(0, 8)
    const other = categoryStats.slice(8).reduce((s, c) => s + c.amount, 0)
    const slices = top.map((c, i) => ({ label: c.name, value: c.amount, color: DONUT_COLORS[i] ?? '#94a3b8' }))
    if (other > 0) slices.push({ label: 'その他', value: other, color: '#94a3b8' })
    return slices
  }, [categoryStats])

  // フィルタ済みアイテム
  const filtered = useMemo(() => {
    const base = ranking.filter(r => {
      const matchSearch = r.menu_item_name.toLowerCase().includes(search.toLowerCase())
      const matchCat    = selCategory === 'all' || (r.category_name ?? '未分類') === selCategory
      return matchSearch && matchCat
    })
    return sort === 'revenue'
      ? base.sort((a, b) => b.total_revenue  - a.total_revenue)
      : base.sort((a, b) => b.total_quantity - a.total_quantity)
  }, [ranking, search, selCategory, sort])

  // ABC分析
  const abcData = useMemo(() => {
    let cumRev = 0
    return filtered.map(item => {
      cumRev += item.total_revenue
      const cumPct = totalRevenue > 0 ? (cumRev / totalRevenue) * 100 : 0
      const abc: 'A' | 'B' | 'C' = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C'
      return { ...item, cumPct, abc }
    })
  }, [filtered, totalRevenue])

  const approxMonths = isPeriodFiltered ? null : Math.round((rowsFetched / 269393) * 120)
  const periodLabel  = selectedFrom && selectedTo ? `${selectedFrom} ～ ${selectedTo}` : isPeriodFiltered ? '全期間' : null

  // HOD表示用
  const activeHodData = activeHod !== null
    ? hodTopItems.find(h => h.hour === activeHod)
    : hodTopItems.find(h => h.hour === 21) ?? hodTopItems[0]

  // DOW表示用
  const activeDowData = activeDow !== null
    ? dowTopItems.find(d => d.dow === activeDow)
    : dowTopItems[5] ?? dowTopItems[0] // 金曜

  const hasTimeData = hodTopItems.some(h => h.items.length > 0) || dowTopItems.some(d => d.items.length > 0)

  return (
    <div className={`max-w-6xl mx-auto space-y-6 transition-opacity duration-150 ${isPending ? 'opacity-50 pointer-events-none' : ''}`}>

      {/* ヘッダー + フィルタ */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h1 className="text-xl font-bold text-slate-700">商品分析</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {storeOptions.map(s => (
              <button key={s.id} onClick={() => navigate(selectedFrom, selectedTo, s.id)} disabled={isPending}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  currentA === s.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
                {s.label}
              </button>
            ))}
            <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-3 py-1">
              {periodLabel
                ? `期間: ${periodLabel} (${rowsFetched.toLocaleString()}件)`
                : approxMonths != null ? `直近約${approxMonths}ヶ月 (${rowsFetched.toLocaleString()}件)` : `${rowsFetched.toLocaleString()}件`}
            </span>
            <button
              onClick={() => downloadCSV(abcData as unknown as Record<string, unknown>[], `items_${selectedFrom??'all'}.csv`)}
              className="text-xs text-slate-500 border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">
              ↓ CSV
            </button>
            {isPending && <span className="flex items-center gap-1.5 text-xs text-blue-500"><span className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin inline-block" />読み込み中…</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {quickSelects.map(q => (
            <button key={q.label} onClick={() => navigate(q.from, q.to)} disabled={isPending}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                selectedFrom === q.from && selectedTo === q.to
                  ? 'bg-blue-600 text-white border-blue-600'
                  : !q.from && !selectedFrom ? 'bg-blue-600 text-white border-blue-600'
                  : 'text-slate-600 border-slate-300 hover:border-blue-400 hover:text-blue-600'
              }`}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={localFrom} onChange={e => setLocalFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <span className="text-slate-400 text-sm">〜</span>
          <input type="date" value={localTo} onChange={e => setLocalTo(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <button onClick={() => navigate(localFrom || null, localTo || null)} disabled={isPending}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors disabled:opacity-50">
            適用
          </button>
        </div>
      </div>

      {/* カテゴリ別売上構成（ドーナツ + バー） */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-600 mb-4">カテゴリ別売上構成</h2>
        {categoryStats.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-6">データがありません</p>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            {/* ドーナツ */}
            <div className="flex flex-col items-center gap-3 shrink-0">
              <DonutChart data={donutData} size={140} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {donutData.slice(0, 8).map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="truncate max-w-20">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* バーチャート */}
            <div className="flex-1 space-y-2 w-full">
              {categoryStats.map((c, i) => {
                const pct = totalRevenue > 0 ? (c.amount / totalRevenue) * 100 : 0
                return (
                  <div key={c.name} className="flex items-center gap-3 group"
                    title={`${c.name}: ${yen(c.amount)} (${pct.toFixed(1)}%)`}>
                    <span
                      className="text-sm text-slate-600 w-32 shrink-0 truncate cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => setSelCategory(c.name === selCategory ? 'all' : c.name)}>
                      {c.name}
                    </span>
                    <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(c.amount / maxCategory) * 100}%`,
                          backgroundColor: DONUT_COLORS[i] ?? '#94a3b8',
                          opacity: selCategory === c.name ? 1 : 0.75,
                        }} />
                    </div>
                    <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{pct.toFixed(0)}%</span>
                    <span className="text-sm font-semibold text-slate-700 w-24 text-right shrink-0 tabular-nums">{yen(c.amount)}</span>
                    <span className="text-xs text-slate-400 w-14 text-right shrink-0 tabular-nums">{c.quantity.toLocaleString()}点</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 商品ランキング + ABC分析 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-slate-600">
            商品ランキング（売上貢献度）
            <span className="ml-2 text-xs font-normal text-slate-400">
              {filtered.length < ranking.length
                ? `${filtered.length.toLocaleString()} / ${ranking.length.toLocaleString()}件`
                : `${ranking.length.toLocaleString()}件`}
            </span>
          </h2>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={() => setSort('revenue')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${sort==='revenue' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                売上金額
              </button>
              <button onClick={() => setSort('quantity')}
                className={`px-3 py-1.5 text-xs font-medium border-l border-slate-200 transition-colors ${sort==='quantity' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                販売数量
              </button>
            </div>
            <select value={selCategory} onChange={e => setSelCategory(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
              {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'すべてのカテゴリ' : c}</option>)}
            </select>
            <input type="text" placeholder="商品名で絞り込み" value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-xs border border-slate-200 rounded px-3 py-1.5 text-slate-600 w-36 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            {(search || selCategory !== 'all') && (
              <button onClick={() => { setSearch(''); setSelCategory('all') }}
                className="text-xs text-blue-500 hover:text-blue-700">リセット</button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 text-xs text-slate-400 font-medium w-8">#</th>
                <th className="text-left py-2 text-xs text-slate-400 font-medium w-8">ABC</th>
                <th className="text-left py-2 text-xs text-slate-400 font-medium">商品名</th>
                <th className="text-left py-2 text-xs text-slate-400 font-medium hidden md:table-cell">カテゴリ</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">売上</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">構成比</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">数量</th>
              </tr>
            </thead>
            <tbody>
              {abcData.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-slate-400 text-xs">該当する商品がありません</td></tr>
              ) : abcData.map((item, i) => {
                const share = totalRevenue > 0 ? (item.total_revenue / totalRevenue) * 100 : 0
                return (
                  <tr key={`${item.menu_item_id}-${i}`} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-400 text-xs tabular-nums">{i + 1}</td>
                    <td className="py-2">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${ABC_COLORS[item.abc]}`}>{item.abc}</span>
                    </td>
                    <td className="py-2 text-slate-700 font-medium max-w-48 truncate">{item.menu_item_name || '（名称不明）'}</td>
                    <td className="py-2 text-slate-400 text-xs hidden md:table-cell">{item.category_name ?? '—'}</td>
                    <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{yen(item.total_revenue)}</td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-12 bg-slate-100 rounded-full h-1.5">
                          <div className="h-full bg-violet-400 rounded-full" style={{ width: `${Math.min(share * 5, 100)}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{share.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">{item.total_quantity.toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-6 flex-wrap">
          <span className="text-xs text-slate-400 font-medium">ABC分析:</span>
          {(['A','B','C'] as const).map(grade => {
            const items = abcData.filter(i => i.abc === grade)
            const rev   = items.reduce((s, i) => s + i.total_revenue, 0)
            return (
              <div key={grade} className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${ABC_COLORS[grade]}`}>{grade}</span>
                <span className="text-xs text-slate-500">
                  {items.length}品 / {totalRevenue > 0 ? ((rev/totalRevenue)*100).toFixed(0) : 0}%
                  {grade==='A'?' (売上上位80%)':grade==='B'?' (80〜95%)':' (95〜100%)'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 原価率ランキング（データなし表示） */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-600 mb-3">原価率ランキング</h2>
        <div className="bg-slate-50 rounded-lg p-4 text-center">
          <p className="text-sm text-slate-500">原価データが未登録です</p>
          <p className="text-xs text-slate-400 mt-1">ユビレジ管理画面で各商品の原価を設定すると、ここに原価率ランキングが表示されます</p>
        </div>
      </div>

      {/* 一緒に注文される商品 */}
      {pairingData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-bold text-slate-600 mb-4">
            よく一緒に注文される商品
            <span className="ml-2 text-xs font-normal text-slate-400">（セット提案用）</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {pairingData.map((pair, i) => (
              <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-400 w-5 text-right shrink-0 tabular-nums">{i + 1}</span>
                <span className="text-xs text-slate-700 font-medium truncate flex-1">{pair.item1}</span>
                <span className="text-xs text-slate-400 shrink-0">×</span>
                <span className="text-xs text-slate-700 font-medium truncate flex-1">{pair.item2}</span>
                <span className="text-xs text-blue-500 font-semibold shrink-0 tabular-nums">{pair.count}回</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 時間帯別人気商品 + 曜日別人気商品 */}
      {hasTimeData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 時間帯別 */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-sm font-bold text-slate-600 mb-3">
              時間帯別人気商品
              <span className="ml-1 text-xs font-normal text-slate-400">（17〜翌1時）</span>
            </h2>
            <div className="flex gap-1 flex-wrap mb-3">
              {HOD_RANGE.map(h => {
                const hasData = hodTopItems.find(d => d.hour === h)?.items.length ?? 0
                return (
                  <button key={h}
                    onClick={() => setActiveHod(activeHod === h ? null : h)}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      (activeHod ?? 21) === h
                        ? 'bg-amber-500 text-white border-amber-500'
                        : hasData > 0 ? 'text-slate-600 border-slate-300 hover:border-amber-400' : 'text-slate-300 border-slate-200'
                    }`}>
                    {h === 0 ? '0時' : h === 1 ? '1時' : `${h}時`}
                  </button>
                )
              })}
            </div>
            {(activeHodData?.items.length ?? 0) === 0 ? (
              <p className="text-slate-400 text-xs py-4 text-center">データがありません</p>
            ) : (
              <div className="space-y-1.5">
                {activeHodData?.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-4 text-right tabular-nums">{i + 1}</span>
                    <span className="text-xs text-slate-700 flex-1 truncate">{item.name}</span>
                    <span className="text-xs font-semibold text-amber-600 tabular-nums">{item.quantity.toLocaleString()}点</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 曜日別 */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-sm font-bold text-slate-600 mb-3">曜日別人気商品</h2>
            <div className="flex gap-1 flex-wrap mb-3">
              {dowTopItems.map(d => (
                <button key={d.dow}
                  onClick={() => setActiveDow(activeDow === d.dow ? null : d.dow)}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors font-semibold ${
                    (activeDow ?? 5) === d.dow
                      ? 'bg-blue-600 text-white border-blue-600'
                      : d.dow === 0 ? 'text-red-400 border-slate-300 hover:border-red-400'
                      : d.dow === 6 ? 'text-blue-400 border-slate-300 hover:border-blue-400'
                      : 'text-slate-600 border-slate-300 hover:border-blue-400'
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
            {(activeDowData?.items.length ?? 0) === 0 ? (
              <p className="text-slate-400 text-xs py-4 text-center">データがありません</p>
            ) : (
              <div className="space-y-1.5">
                {activeDowData?.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-4 text-right tabular-nums">{i + 1}</span>
                    <span className="text-xs text-slate-700 flex-1 truncate">{item.name}</span>
                    <span className="text-xs font-semibold text-blue-600 tabular-nums">{item.quantity.toLocaleString()}点</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 季節別売上 */}
      {seasonalData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-bold text-slate-600 mb-4">季節別売上</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {seasonalData.map(s => (
              <div key={s.key} className="bg-slate-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SEASON_COLORS[s.key]}`}>{s.label}</span>
                </div>
                <p className="text-base font-bold text-slate-700 tabular-nums mb-2">{yen(s.total)}</p>
                <div className="space-y-1">
                  {s.items.map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-400 tabular-nums w-3">{i + 1}</span>
                      <span className="text-xs text-slate-600 truncate">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
