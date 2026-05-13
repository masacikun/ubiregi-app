'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useMemo, useTransition } from 'react'
import { STORES, ALL_LABEL } from '@/lib/stores'

type DailyRow = {
  sale_date:          string
  total:              number
  checkout_count:     number
  discount_amount:    number
  avg_checkout_value: number
}

type Props = {
  dailyCurrent:   DailyRow[]
  prevDayMap:     Record<string, number>
  paymentData:    { name: string; amount: number }[]
  dowData:        { dow: number; label: string; total: number; count: number }[]
  hodData:        { hour: number; total: number; count: number }[]
  hodDowMatrix:   number[][]
  periodTotal:    number
  periodCount:    number
  periodDiscount: number
  yoyRevenue:     number | null
  yoyCount:       number | null
  selectedFrom:   string
  selectedTo:     string
  currentA:       string
  earliestYear:   number
}

const DOW_COLORS_CLS = ['text-red-500','text-slate-600','text-slate-600','text-slate-600','text-slate-600','text-slate-600','text-blue-500']
const DOW_NAMES = ['日','月','火','水','木','金','土']
const HOD_RANGE = [17,18,19,20,21,22,23,0,1]
const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

function yen(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}
function pctStr(n: number, digits = 1) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}
function abbr(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}百万`
  if (n >= 10_000)    return `${Math.round(n / 10_000)}万`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}千`
  return String(n)
}
function addDays(d: string, n: number): string {
  const [y, mo, day] = d.split('-').map(Number)
  const dt = new Date(y, mo - 1, day + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay() || 7
  const thu = new Date(d); thu.setDate(d.getDate() + 4 - dow)
  const jan1 = new Date(thu.getFullYear(), 0, 1)
  const w = Math.ceil(((thu.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return `${thu.getFullYear()}-W${String(w).padStart(2, '0')}`
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

function KpiCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: number | null }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex flex-col gap-1">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
      {trend != null && (
        <p className={`text-xs font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}% 前年比
        </p>
      )}
    </div>
  )
}

function SparkLine({ values, color = '#3b82f6', height = 48 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return <div style={{ height }} className="bg-slate-50 rounded" />
  const W = 400
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = (height - 4) - (v / max) * (height - 8) + 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function SalesClient({
  dailyCurrent, prevDayMap, paymentData, dowData, hodData, hodDowMatrix,
  periodTotal, periodCount, periodDiscount, yoyRevenue, yoyCount,
  selectedFrom, selectedTo, currentA, earliestYear,
}: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [view,           setView]          = useState<'day' | 'week' | 'month'>('day')
  const [localFrom,      setLocalFrom]     = useState(selectedFrom)
  const [localTo,        setLocalTo]       = useState(selectedTo)
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set())

  function toggleMonth(m: number) {
    setSelectedMonths(prev => {
      const s = new Set(prev)
      if (s.has(m)) s.delete(m); else s.add(m)
      return s
    })
  }

  function navigate(from: string, to: string, a?: string) {
    setSelectedMonths(new Set())
    startTransition(() => router.push(`${pathname}?a=${a ?? currentA}&from=${from}&to=${to}`))
  }

  const storeOptions = [
    { id: 'all', label: ALL_LABEL },
    ...STORES.map(s => ({ id: String(s.id), label: s.label })),
  ]

  const today    = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  const quickSelects = [
    { label: '今日',  from: todayStr, to: todayStr },
    { label: '今週',  from: (() => { const d=new Date(today); d.setDate(d.getDate()-((d.getDay()||7)-1)); return d.toISOString().split('T')[0] })(), to: todayStr },
    { label: '今月',  from: todayStr.substring(0,7)+'-01', to: todayStr },
    { label: '先月',  from: (() => { const d=new Date(today.getFullYear(),today.getMonth()-1,1); return d.toISOString().split('T')[0] })(),
                      to:   (() => { const d=new Date(today.getFullYear(),today.getMonth(),0);   return d.toISOString().split('T')[0] })() },
    { label: '今年',  from: `${today.getFullYear()}-01-01`, to: todayStr },
    { label: '去年',  from: `${today.getFullYear()-1}-01-01`, to: `${today.getFullYear()-1}-12-31` },
  ]

  // 年度別クイック選択（8月〜7月）
  const currentFY = today.getMonth() + 1 >= 8 ? today.getFullYear() : today.getFullYear() - 1
  const fiscalYears = [currentFY, currentFY - 1, currentFY - 2].map(fy => {
    const fyEnd = `${fy + 1}-07-31`
    return { label: `${fy}年度`, from: `${fy}-08-01`, to: fyEnd <= todayStr ? fyEnd : todayStr }
  })

  // 月フィルタ後の日次データ
  const filteredDaily = useMemo(() => {
    if (selectedMonths.size === 0) return dailyCurrent
    return dailyCurrent.filter(d => {
      const m = new Date(d.sale_date + 'T00:00:00').getMonth() + 1
      return selectedMonths.has(m)
    })
  }, [dailyCurrent, selectedMonths])

  // フィルタ後KPI
  const displayTotal    = useMemo(() => filteredDaily.reduce((s, d) => s + Number(d.total), 0),           [filteredDaily])
  const displayCount    = useMemo(() => filteredDaily.reduce((s, d) => s + Number(d.checkout_count), 0),  [filteredDaily])
  const displayDiscount = useMemo(() => filteredDaily.reduce((s, d) => s + Number(d.discount_amount), 0), [filteredDaily])
  const displayAvg      = displayCount > 0 ? Math.round(displayTotal / displayCount) : 0
  const displayPrevTotal = useMemo(() => filteredDaily.reduce((s, d) => s + (prevDayMap[d.sale_date] ?? 0), 0), [filteredDaily, prevDayMap])
  const displayYoy      = displayPrevTotal > 0 ? ((displayTotal - displayPrevTotal) / displayPrevTotal) * 100 : null

  // メインチャートデータ (filteredDaily ベース)
  const chartData = useMemo(() => {
    if (view === 'day') {
      return filteredDaily.map(d => ({
        label:     d.sale_date,
        display:   new Date(d.sale_date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }),
        total:     Number(d.total),
        count:     Number(d.checkout_count),
        prevTotal: prevDayMap[d.sale_date] ?? 0,
      }))
    }
    if (view === 'week') {
      const map: Record<string, { label: string; total: number; count: number; prevTotal: number }> = {}
      for (const d of filteredDaily) {
        const w = isoWeek(d.sale_date)
        if (!map[w]) map[w] = { label: w, total: 0, count: 0, prevTotal: 0 }
        map[w].total += Number(d.total); map[w].count += Number(d.checkout_count)
        map[w].prevTotal += prevDayMap[d.sale_date] ?? 0
      }
      return Object.values(map).sort((a, b) => a.label.localeCompare(b.label))
    }
    const map: Record<string, { label: string; display: string; total: number; count: number; discount: number; prevTotal: number }> = {}
    for (const d of filteredDaily) {
      const m = d.sale_date.substring(0, 7)
      if (!map[m]) map[m] = { label: m, display: new Date(m + '-01T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'short' }), total: 0, count: 0, discount: 0, prevTotal: 0 }
      map[m].total += Number(d.total); map[m].count += Number(d.checkout_count)
      map[m].discount += Number(d.discount_amount); map[m].prevTotal += prevDayMap[d.sale_date] ?? 0
    }
    return Object.values(map).sort((a, b) => a.label.localeCompare(b.label))
  }, [filteredDaily, prevDayMap, view])

  const showValues  = view === 'month' || (view === 'week' && chartData.length <= 20) || (view === 'day' && chartData.length <= 31)
  const chartMax    = Math.max(...chartData.map(d => Math.max(d.total, d.prevTotal)), 1)
  const totalPayment = paymentData.reduce((s, p) => s + p.amount, 0)

  // 時間帯別 17-25
  const filteredHod = HOD_RANGE.map(h => hodData.find(d => d.hour === h) ?? { hour: h, total: 0, count: 0 })
  const maxHod = Math.max(...filteredHod.map(h => h.total), 1)

  // 曜日別 (filteredDailyから再計算)
  const dowDataFiltered = useMemo(() => {
    const tots = Array(7).fill(0), cnts = Array(7).fill(0)
    for (const d of filteredDaily) {
      const dow = new Date(d.sale_date + 'T00:00:00').getDay()
      tots[dow] += Number(d.total); cnts[dow] += Number(d.checkout_count)
    }
    return Array.from({length:7}, (_,i) => ({ dow:i, label: DOW_NAMES[i], total: tots[i], count: cnts[i] }))
  }, [filteredDaily])
  const maxDow = Math.max(...dowDataFiltered.map(d => d.total), 1)

  // トレンドデータ（filteredDailyから）
  const avgByDay          = filteredDaily.map(d => Number(d.checkout_count) > 0 ? Math.round(Number(d.total) / Number(d.checkout_count)) : 0)
  const countByDay        = filteredDaily.map(d => Number(d.checkout_count))
  const discountRateByDay = filteredDaily.map(d => Number(d.total) > 0 ? (Number(d.discount_amount) / Number(d.total)) * 100 : 0)

  // 累計売上
  const cumulativeData = useMemo(() => {
    let cum = 0
    return filteredDaily.map(d => { cum += Number(d.total); return cum })
  }, [filteredDaily])

  // 月別テーブル
  const monthlyRows = useMemo(() => {
    const map: Record<string, { month: string; total: number; count: number; discount: number; prevTotal: number }> = {}
    for (const d of filteredDaily) {
      const m = d.sale_date.substring(0, 7)
      if (!map[m]) map[m] = { month: m, total: 0, count: 0, discount: 0, prevTotal: 0 }
      map[m].total    += Number(d.total); map[m].count += Number(d.checkout_count)
      map[m].discount += Number(d.discount_amount); map[m].prevTotal += prevDayMap[d.sale_date] ?? 0
    }
    const rows = Object.values(map).sort((a, b) => b.month.localeCompare(a.month))
    const totals = rows.reduce((acc, r) => ({ total: acc.total + r.total, count: acc.count + r.count, discount: acc.discount + r.discount }), { total: 0, count: 0, discount: 0 })
    return { rows, totals }
  }, [filteredDaily, prevDayMap])

  // 週別テーブル
  const weeklyData = useMemo(() => {
    const map: Record<string, { week: string; total: number; count: number; discount: number; days: number }> = {}
    for (const d of filteredDaily) {
      const w = isoWeek(d.sale_date)
      if (!map[w]) map[w] = { week: w, total: 0, count: 0, discount: 0, days: 0 }
      map[w].total    += Number(d.total)
      map[w].count    += Number(d.checkout_count)
      map[w].discount += Number(d.discount_amount)
      map[w].days     += 1
    }
    return Object.values(map).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 52)
  }, [filteredDaily])

  // 曜日別統計（平均・最高・最低）
  const dowStats = useMemo(() => {
    const map: Record<number, number[]> = {}
    for (let i = 0; i < 7; i++) map[i] = []
    for (const d of filteredDaily) {
      if (Number(d.total) === 0) continue
      const dow = new Date(d.sale_date + 'T00:00:00').getDay()
      map[dow].push(Number(d.total))
    }
    return Array.from({length:7}, (_,i) => {
      const v = map[i]
      if (!v.length) return { dow:i, avg:0, max:0, min:0, count:0 }
      return {
        dow:   i,
        avg:   Math.round(v.reduce((s,x)=>s+x,0)/v.length),
        max:   Math.max(...v),
        min:   Math.min(...v),
        count: v.length,
      }
    })
  }, [filteredDaily])

  // 月別前年比テーブル
  const monthlyYoY = useMemo(() => {
    const map: Record<string, { month: string; total: number; prevTotal: number; count: number }> = {}
    for (const d of filteredDaily) {
      const m = d.sale_date.substring(0, 7)
      if (!map[m]) map[m] = { month: m, total: 0, prevTotal: 0, count: 0 }
      map[m].total     += Number(d.total)
      map[m].prevTotal += prevDayMap[d.sale_date] ?? 0
      map[m].count     += Number(d.checkout_count)
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  }, [filteredDaily, prevDayMap])

  // 週末vs平日
  const weekdayWeekend = useMemo(() => {
    let wdTotal=0, wdCount=0, wdDays=0, weTotal=0, weCount=0, weDays=0
    for (const d of filteredDaily) {
      const dow = new Date(d.sale_date + 'T00:00:00').getDay()
      if (dow === 0 || dow === 6) {
        weTotal += Number(d.total); weCount += Number(d.checkout_count); weDays++
      } else {
        wdTotal += Number(d.total); wdCount += Number(d.checkout_count); wdDays++
      }
    }
    return {
      weekday: { total:wdTotal, count:wdCount, days:wdDays, avg: wdDays>0?Math.round(wdTotal/wdDays):0 },
      weekend: { total:weTotal, count:weCount, days:weDays, avg: weDays>0?Math.round(weTotal/weDays):0 },
    }
  }, [filteredDaily])

  // 上位・下位10日
  const sortedDays = useMemo(() => [...filteredDaily].filter(d=>Number(d.total)>0).sort((a,b)=>Number(b.total)-Number(a.total)), [filteredDaily])

  // 月初・月中・月末パターン
  const monthPeriodData = useMemo(() => {
    const bands = [
      { label:'月初(1〜10日)', min:1,  max:10 },
      { label:'月中(11〜20日)', min:11, max:20 },
      { label:'月末(21日〜)',   min:21, max:31 },
    ]
    return bands.map(band => {
      const rows = filteredDaily.filter(d => {
        const day = parseInt(d.sale_date.slice(8,10))
        return day >= band.min && day <= band.max
      })
      const total = rows.reduce((s,d)=>s+Number(d.total),0)
      const count = rows.reduce((s,d)=>s+Number(d.checkout_count),0)
      const days  = rows.filter(d=>Number(d.total)>0).length
      return { label:band.label, total, count, days, avg: days>0?Math.round(total/days):0 }
    })
  }, [filteredDaily])

  // 時間帯別テーブル (17-25)
  const hodTableData = HOD_RANGE.map(h => {
    const d = hodData.find(hd => hd.hour === h)
    return { hour: h, total: d?.total??0, count: d?.count??0, avg: d?.count ? Math.round((d?.total??0)/d.count) : 0 }
  })

  // DOW×HOD ヒートマップ最大値
  const hmVals = hodDowMatrix.flatMap(row => HOD_RANGE.map(h => row[h]))
  const hmMax  = Math.max(...hmVals, 1)

  const monthFilterActive = selectedMonths.size > 0

  return (
    <div className={`max-w-6xl mx-auto space-y-6 transition-opacity duration-150 ${isPending ? 'opacity-50 pointer-events-none' : ''}`}>

      {/* ヘッダー + 期間フィルタ */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h1 className="text-xl font-bold text-slate-800">売上分析</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {storeOptions.map(s => (
              <button key={s.id} onClick={() => navigate(selectedFrom, selectedTo, s.id)} disabled={isPending}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  currentA === s.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
                {s.label}
              </button>
            ))}
            <button
              onClick={() => downloadCSV(dailyCurrent as unknown as Record<string, unknown>[], `sales_${selectedFrom}_${selectedTo}.csv`)}
              className="text-xs text-slate-500 border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50 transition-colors">
              ↓ CSV
            </button>
            {isPending && <span className="flex items-center gap-1.5 text-xs text-blue-500"><span className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin inline-block" />読み込み中…</span>}
          </div>
        </div>

        {/* クイック選択 */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          {quickSelects.map(q => (
            <button key={q.label} onClick={() => navigate(q.from, q.to)} disabled={isPending}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                selectedFrom === q.from && selectedTo === q.to && !monthFilterActive
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'text-slate-600 border-slate-300 hover:border-blue-400 hover:text-blue-600'
              }`}>
              {q.label}
            </button>
          ))}
        </div>
        {/* 年度別 */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-xs text-slate-400 shrink-0">年度:</span>
          {fiscalYears.map(q => (
            <button key={q.label} onClick={() => navigate(q.from, q.to)} disabled={isPending}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                selectedFrom === q.from && selectedTo === q.to && !monthFilterActive
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'text-indigo-600 border-indigo-300 hover:bg-indigo-50'
              }`}>
              {q.label}
            </button>
          ))}
        </div>

        {/* 日付入力 */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <input type="date" value={localFrom} onChange={e => setLocalFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <span className="text-slate-400 text-sm">〜</span>
          <input type="date" value={localTo} onChange={e => setLocalTo(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <button onClick={() => navigate(localFrom, localTo)} disabled={isPending}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors disabled:opacity-50">
            適用
          </button>
          <span className="text-xs text-slate-400 ml-1">{selectedFrom} ～ {selectedTo}</span>
        </div>

        {/* 月フィルタ */}
        <div className="pt-3 border-t border-slate-100">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-500 shrink-0">月絞込:</span>
            {MONTH_NAMES.map((label, i) => {
              const m = i + 1
              return (
                <button key={m} onClick={() => toggleMonth(m)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    selectedMonths.has(m)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'text-slate-500 border-slate-300 hover:border-blue-400'
                  }`}>
                  {label}
                </button>
              )
            })}
            {monthFilterActive && (
              <button onClick={() => setSelectedMonths(new Set())}
                className="text-xs text-red-500 hover:text-red-700 ml-1">
                クリア
              </button>
            )}
          </div>
          {monthFilterActive && (
            <p className="text-xs text-blue-500 mt-1.5">
              {[...selectedMonths].sort((a,b)=>a-b).map(m=>MONTH_NAMES[m-1]).join('・')} のデータを表示中
            </p>
          )}
        </div>
      </div>

      {/* KPI カード */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="売上合計"  value={yen(displayTotal)}   trend={monthFilterActive ? displayYoy : yoyRevenue} />
        <KpiCard label="会計件数"  value={`${displayCount.toLocaleString()}件`}
          sub={!monthFilterActive && yoyCount != null ? `前年比 ${pctStr(yoyCount)}` : undefined} />
        <KpiCard label="客単価"    value={yen(displayAvg)} />
        <KpiCard label="値引き合計" value={yen(displayDiscount)}
          sub={displayTotal > 0 ? `売上比 ${((displayDiscount / displayTotal) * 100).toFixed(1)}%` : undefined} />
      </div>

      {/* メインチャート（日別/週別/月別） */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-sm font-bold text-slate-600">売上推移</h2>
          <div className="flex gap-1.5 items-center">
            <div className="flex items-center gap-2 text-xs text-slate-400 mr-3">
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-400 inline-block" />当期</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-slate-200 inline-block" />前年</span>
            </div>
            {(['day','week','month'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${view===v ? 'bg-blue-600 text-white border-blue-600' : 'text-slate-600 border-slate-300 hover:border-blue-400'}`}>
                {v==='day'?'日別':v==='week'?'週別':'月別'}
              </button>
            ))}
          </div>
        </div>
        {chartData.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-10">データがありません</p>
        ) : (
          <div className={`flex items-end gap-0.5 ${view==='day'&&chartData.length>60?'h-36':'h-48'} relative`}>
            {chartData.map(d => {
              const curPct  = (d.total    / chartMax) * 100
              const prevPct = (d.prevTotal / chartMax) * 100
              const yoy     = d.prevTotal > 0 ? ((d.total - d.prevTotal) / d.prevTotal) * 100 : null
              const barH    = view==='day'&&chartData.length>60 ? '80px' : '108px'
              return (
                <div key={d.label} className="flex-1 flex flex-col items-center min-w-0 group"
                  title={`${d.label}\n当期: ${yen(d.total)}${yoy != null ? ` (${pctStr(yoy)})` : ''}`}>
                  {/* 数値ラベル */}
                  {showValues && (
                    <span className="text-slate-600 font-semibold tabular-nums leading-none mb-0.5 truncate w-full text-center" style={{ fontSize: '8px' }}>
                      {abbr(d.total)}
                    </span>
                  )}
                  {/* バー */}
                  <div className="w-full flex items-end gap-px flex-1">
                    <div className="flex-1 bg-slate-200 rounded-t" style={{ height: `${prevPct}%` }} />
                    <div className={`flex-1 rounded-t transition-all ${yoy != null ? (yoy >= 0 ? 'bg-blue-400 group-hover:bg-blue-500' : 'bg-rose-400 group-hover:bg-rose-500') : 'bg-blue-400 group-hover:bg-blue-500'}`}
                      style={{ height: `${Math.max(curPct, 0.5)}%` }} />
                  </div>
                  {/* ラベル */}
                  {(view==='month' || (view==='day'&&chartData.length<=31) || (view==='week'&&chartData.length<=12)) && (
                    <span className="text-xs text-slate-400 truncate w-full text-center mt-0.5" style={{ fontSize: '9px' }}>
                      {view==='day' ? (('display' in d) ? (d as any).display : d.label) : d.label.replace(/.*-/,'')}
                    </span>
                  )}
                  {yoy != null && view === 'month' && (
                    <span className={`text-xs font-semibold ${yoy >= 0 ? 'text-emerald-600' : 'text-red-500'}`} style={{ fontSize: '9px' }}>
                      {yoy >= 0 ? '+' : ''}{yoy.toFixed(0)}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 累計売上 */}
      {cumulativeData.length > 1 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-600">累計売上</h2>
            <span className="text-lg font-bold text-blue-600 tabular-nums">{yen(cumulativeData[cumulativeData.length - 1] ?? 0)}</span>
          </div>
          <SparkLine values={cumulativeData} color="#3b82f6" height={56} />
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>{filteredDaily[0]?.sale_date}</span>
            <span>{filteredDaily[filteredDaily.length - 1]?.sale_date}</span>
          </div>
        </div>
      )}

      {/* トレンド 3枚（客単価・会計数・値引き率） */}
      {filteredDaily.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">客単価推移</h2>
              <span className="text-sm font-bold text-slate-700 tabular-nums">{yen(avgByDay[avgByDay.length - 1] ?? 0)}</span>
            </div>
            <SparkLine values={avgByDay} color="#10b981" height={52} />
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">会計数推移</h2>
              <span className="text-sm font-bold text-slate-700 tabular-nums">{countByDay[countByDay.length - 1]?.toLocaleString() ?? 0}件/日</span>
            </div>
            <SparkLine values={countByDay} color="#8b5cf6" height={52} />
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">値引き率推移</h2>
              <span className="text-sm font-bold text-slate-700 tabular-nums">{(discountRateByDay[discountRateByDay.length - 1] ?? 0).toFixed(1)}%</span>
            </div>
            <SparkLine values={discountRateByDay} color="#f59e0b" height={52} />
          </div>
        </div>
      )}

      {/* 月別詳細テーブル */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-600 mb-4">月別詳細</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 text-xs text-slate-400 font-medium">月</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">売上</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">前年比</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">前月比</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">会計数</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">客単価</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">値引き</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium hidden md:table-cell">値引き率</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.rows.map((row, idx) => {
                const yoy = row.prevTotal > 0 ? ((row.total - row.prevTotal) / row.prevTotal) * 100 : null
                const prevM = monthlyRows.rows[idx + 1]
                const mom   = prevM && prevM.total > 0 ? ((row.total - prevM.total) / prevM.total) * 100 : null
                const discRate = row.total > 0 ? (row.discount / row.total) * 100 : 0
                return (
                  <tr key={row.month} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-600 text-sm">
                      {new Date(row.month + '-01T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{yen(row.total)}</td>
                    <td className="py-2 text-right">
                      {yoy != null ? <span className={`text-xs font-semibold ${yoy >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{pctStr(yoy)}</span> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="py-2 text-right">
                      {mom != null ? <span className={`text-xs font-semibold ${mom >= 0 ? 'text-blue-600' : 'text-slate-500'}`}>{pctStr(mom)}</span> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">{row.count.toLocaleString()}</td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">{yen(row.count > 0 ? Math.round(row.total / row.count) : 0)}</td>
                    <td className="py-2 text-right text-red-400 tabular-nums">{yen(row.discount)}</td>
                    <td className="py-2 text-right text-slate-400 tabular-nums hidden md:table-cell">{discRate.toFixed(1)}%</td>
                  </tr>
                )
              })}
              {monthlyRows.rows.length > 1 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td className="py-2 text-slate-700">合計</td>
                  <td className="py-2 text-right text-slate-800 tabular-nums">{yen(monthlyRows.totals.total)}</td>
                  <td colSpan={2} />
                  <td className="py-2 text-right text-slate-600 tabular-nums">{monthlyRows.totals.count.toLocaleString()}</td>
                  <td className="py-2 text-right text-slate-600 tabular-nums">{yen(monthlyRows.totals.count > 0 ? Math.round(monthlyRows.totals.total / monthlyRows.totals.count) : 0)}</td>
                  <td className="py-2 text-right text-red-500 tabular-nums">{yen(monthlyRows.totals.discount)}</td>
                  <td className="py-2 text-right text-slate-400 tabular-nums hidden md:table-cell">
                    {monthlyRows.totals.total > 0 ? ((monthlyRows.totals.discount / monthlyRows.totals.total) * 100).toFixed(1) : 0}%
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 週別テーブル */}
      {weeklyData.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-sm font-bold text-slate-600 mb-4">週別売上テーブル</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-xs text-slate-400 font-medium">週</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">売上</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">会計数</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">日平均</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">値引き</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium hidden md:table-cell">営業日数</th>
                </tr>
              </thead>
              <tbody>
                {weeklyData.map(row => (
                  <tr key={row.week} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-600 font-medium text-xs">{row.week}</td>
                    <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{yen(row.total)}</td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">{row.count.toLocaleString()}</td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">{yen(row.days > 0 ? Math.round(row.total / row.days) : 0)}</td>
                    <td className="py-2 text-right text-red-400 tabular-nums">{yen(row.discount)}</td>
                    <td className="py-2 text-right text-slate-400 tabular-nums hidden md:table-cell">{row.days}日</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 月初・月中・月末パターン */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-600 mb-4">月内パターン分析</h2>
        <div className="grid grid-cols-3 gap-4">
          {monthPeriodData.map((band, i) => {
            const totalRev = monthPeriodData.reduce((s, b) => s + b.total, 0)
            const pct = totalRev > 0 ? (band.total / totalRev) * 100 : 0
            const colors = ['bg-blue-400', 'bg-violet-400', 'bg-emerald-400']
            return (
              <div key={i} className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-500 mb-1">{band.label}</p>
                <p className="text-base font-bold text-slate-800 tabular-nums">{yen(band.total)}</p>
                <div className="h-1.5 bg-slate-200 rounded-full mt-2 mb-2">
                  <div className={`h-full rounded-full ${colors[i]}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>日平均 {yen(band.avg)}</span>
                  <span>{pct.toFixed(0)}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 曜日別 + 時間帯別 17-25 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-sm font-bold text-slate-600 mb-4">曜日別売上</h2>
          {dowDataFiltered.every(d => d.total === 0) ? (
            <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
          ) : (
            <div className="space-y-2">
              {dowDataFiltered.map(d => (
                <div key={d.dow} className="flex items-center gap-2 group">
                  <span className={`text-sm font-bold w-5 shrink-0 ${DOW_COLORS_CLS[d.dow]}`}>{d.label}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                    <div className="h-full bg-blue-400 group-hover:bg-blue-500 rounded-full transition-all" style={{ width: `${(d.total / maxDow) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-24 text-right shrink-0 tabular-nums">{yen(d.total)}</span>
                  <span className="text-xs text-slate-400 w-10 text-right shrink-0">{d.count}件</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-sm font-bold text-slate-600 mb-4">
            時間帯別売上 <span className="text-xs font-normal text-slate-400">（17〜翌1時）</span>
          </h2>
          {filteredHod.every(h => h.total === 0) ? (
            <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
          ) : (
            <div className="flex items-end gap-1 h-36">
              {filteredHod.map((h, idx) => {
                const p = (h.total / maxHod) * 100
                return (
                  <div key={h.hour} className="flex-1 flex flex-col items-center gap-0 group"
                    title={`${h.hour}時: ${yen(h.total)} / ${h.count}件`}>
                  {/* 数値ラベル */}
                  <span className="tabular-nums text-slate-500 mb-0.5 leading-none" style={{ fontSize: '7px' }}>
                    {h.total >= 10000 ? `${Math.round(h.total/10000)}万` : ''}
                  </span>
                    <div className="flex-1 w-full flex items-end">
                      <div className={`w-full rounded-t transition-all ${h.count > 0 ? 'bg-amber-400 group-hover:bg-amber-500' : 'bg-slate-100'}`}
                        style={{ height: `${Math.max(p, h.count > 0 ? 2 : 0)}%` }} />
                    </div>
                    <span className="text-xs text-slate-400" style={{ fontSize: '9px' }}>
                      {idx === 7 ? '0' : idx === 8 ? '1' : String(17 + idx)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 曜日別統計テーブル（平均・最高・最低） */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-600 mb-4">曜日別売上統計</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 text-xs text-slate-400 font-medium w-8">曜日</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">平均</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">最高</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">最低</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">営業日数</th>
              </tr>
            </thead>
            <tbody>
              {dowStats.map(row => (
                <tr key={row.dow} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className={`py-2 font-bold text-sm ${DOW_COLORS_CLS[row.dow]}`}>{DOW_NAMES[row.dow]}</td>
                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{row.count > 0 ? yen(row.avg) : '—'}</td>
                  <td className="py-2 text-right text-emerald-600 tabular-nums">{row.count > 0 ? yen(row.max) : '—'}</td>
                  <td className="py-2 text-right text-red-400 tabular-nums">{row.count > 0 ? yen(row.min) : '—'}</td>
                  <td className="py-2 text-right text-slate-400 tabular-nums">{row.count}日</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 週末vs平日 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-600 mb-4">週末 vs 平日 比較</h2>
        <div className="grid grid-cols-2 gap-6">
          {[
            { label: '平日（月〜金）', data: weekdayWeekend.weekday, color: 'bg-blue-100 text-blue-700' },
            { label: '週末（土・日）', data: weekdayWeekend.weekend, color: 'bg-violet-100 text-violet-700' },
          ].map(({ label, data, color }) => (
            <div key={label} className="bg-slate-50 rounded-xl p-4">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color} mb-3 inline-block`}>{label}</span>
              <p className="text-xl font-bold text-slate-800 tabular-nums">{yen(data.total)}</p>
              <p className="text-xs text-slate-500 mt-1">日平均: <span className="font-semibold text-slate-700">{yen(data.avg)}</span></p>
              <p className="text-xs text-slate-400">{data.days}日 / {data.count.toLocaleString()}会計</p>
            </div>
          ))}
        </div>
        {weekdayWeekend.weekday.days > 0 && weekdayWeekend.weekend.days > 0 && (
          <p className="text-xs text-slate-400 mt-3 text-right">
            週末/平日比: {weekdayWeekend.weekday.avg > 0 ? ((weekdayWeekend.weekend.avg / weekdayWeekend.weekday.avg) * 100).toFixed(0) : '—'}%
          </p>
        )}
      </div>

      {/* 売上上位・下位 TOP10 */}
      {sortedDays.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h2 className="text-sm font-bold text-slate-600 mb-4">売上上位10日</h2>
            <div className="space-y-1.5">
              {sortedDays.slice(0, 10).map((d, i) => {
                const dow = new Date(d.sale_date + 'T00:00:00').getDay()
                return (
                  <div key={d.sale_date} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-4 tabular-nums">{i+1}</span>
                    <span className={`text-xs font-bold w-4 ${DOW_COLORS_CLS[dow]}`}>{DOW_NAMES[dow]}</span>
                    <span className="text-xs text-slate-600 w-24">{d.sale_date}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2">
                      <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(Number(d.total) / Number(sortedDays[0]?.total ?? 1)) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 w-20 text-right tabular-nums">{yen(Number(d.total))}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h2 className="text-sm font-bold text-slate-600 mb-4">売上下位10日</h2>
            <div className="space-y-1.5">
              {[...sortedDays].reverse().slice(0, 10).map((d, i) => {
                const dow = new Date(d.sale_date + 'T00:00:00').getDay()
                return (
                  <div key={d.sale_date} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-4 tabular-nums">{i+1}</span>
                    <span className={`text-xs font-bold w-4 ${DOW_COLORS_CLS[dow]}`}>{DOW_NAMES[dow]}</span>
                    <span className="text-xs text-slate-600 w-24">{d.sale_date}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2">
                      <div className="h-full bg-rose-400 rounded-full" style={{ width: `${(Number(d.total) / Number(sortedDays[0]?.total ?? 1)) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 w-20 text-right tabular-nums">{yen(Number(d.total))}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* 曜日×時間帯ヒートマップ */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-600 mb-4">
          曜日×時間帯 クロス集計
          <span className="text-xs font-normal text-slate-400 ml-2">（17〜翌1時・期間全体）</span>
        </h2>
        {hmMax <= 1 ? (
          <p className="text-slate-400 text-sm text-center py-6">データがありません（期間を広げてください）</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: '100%' }}>
              <thead>
                <tr>
                  <th className="w-8 pr-2" />
                  {HOD_RANGE.map(h => (
                    <th key={h} className="text-center text-slate-400 font-normal py-1 px-0.5 w-12">
                      {h === 0 ? '0(深)' : h === 1 ? '1(深)' : `${h}時`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hodDowMatrix.map((row, di) => (
                  <tr key={di}>
                    <td className={`text-center font-bold py-0.5 pr-2 ${di===0?'text-red-500':di===6?'text-blue-500':'text-slate-500'}`}>
                      {DOW_NAMES[di]}
                    </td>
                    {HOD_RANGE.map(h => {
                      const val   = row[h]
                      const alpha = val > 0 ? Math.max(0.1, (val / hmMax) * 0.9) : 0
                      return (
                        <td key={h} className="py-0.5 px-0.5">
                          <div className="h-8 rounded flex items-center justify-center"
                            style={{ backgroundColor: val > 0 ? `rgba(59,130,246,${alpha})` : '#f1f5f9' }}
                            title={`${DOW_NAMES[di]}曜 ${h}時: ${yen(val)}`}>
                            {val >= 10000 && (
                              <span className="text-white font-semibold" style={{ fontSize: '9px' }}>
                                {(val / 10000).toFixed(0)}万
                              </span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 時間帯別テーブル (17-25) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-600 mb-4">
          時間帯別売上テーブル <span className="text-xs font-normal text-slate-400">（17〜翌1時・期間全体）</span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 text-xs text-slate-400 font-medium">時間帯</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">売上</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">会計数</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">客単価</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium hidden md:table-cell">構成比</th>
              </tr>
            </thead>
            <tbody>
              {hodTableData.map((row, idx) => {
                const totalHod = hodTableData.reduce((s, r) => s + r.total, 0)
                const pct = totalHod > 0 ? (row.total / totalHod) * 100 : 0
                return (
                  <tr key={row.hour} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-600 font-medium text-sm">
                      {row.hour === 0 ? '0時（深夜）' : row.hour === 1 ? '1時（深夜）' : `${row.hour}時`}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{row.total > 0 ? yen(row.total) : '—'}</td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">{row.count > 0 ? `${row.count.toLocaleString()}件` : '—'}</td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">{row.avg > 0 ? yen(row.avg) : '—'}</td>
                    <td className="py-2 text-right hidden md:table-cell">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-slate-100 rounded-full h-1.5">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 tabular-nums w-8">{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 月別前年比テーブル */}
      {monthlyYoY.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-sm font-bold text-slate-600 mb-4">前年同月比テーブル</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-xs text-slate-400 font-medium">月</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">当期売上</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">前年同月</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">前年比</th>
                  <th className="text-right py-2 text-xs text-slate-400 font-medium">差額</th>
                </tr>
              </thead>
              <tbody>
                {monthlyYoY.map(row => {
                  const yoy  = row.prevTotal > 0 ? ((row.total - row.prevTotal) / row.prevTotal) * 100 : null
                  const diff = row.total - row.prevTotal
                  return (
                    <tr key={row.month} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-2 text-slate-600 text-sm">
                        {new Date(row.month + '-01T00:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}
                      </td>
                      <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{yen(row.total)}</td>
                      <td className="py-2 text-right text-slate-400 tabular-nums">{row.prevTotal > 0 ? yen(row.prevTotal) : '—'}</td>
                      <td className="py-2 text-right">
                        {yoy != null ? <span className={`text-xs font-semibold ${yoy >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{pctStr(yoy)}</span> : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="py-2 text-right">
                        {row.prevTotal > 0 ? <span className={`text-xs font-semibold ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{diff >= 0 ? '+' : ''}{yen(diff)}</span> : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 支払方法別 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <h2 className="text-sm font-bold text-slate-600 mb-4">支払方法別</h2>
        {paymentData.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
        ) : (
          <div className="space-y-2.5">
            {paymentData.map(p => {
              const pct = totalPayment > 0 ? (p.amount / totalPayment) * 100 : 0
              return (
                <div key={p.name} className="flex items-center gap-3 group">
                  <span className="text-xs text-slate-600 w-28 shrink-0 truncate">{p.name}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-3.5 overflow-hidden">
                    <div className="h-full bg-emerald-400 group-hover:bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-24 text-right shrink-0 tabular-nums">{yen(p.amount)}</span>
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
