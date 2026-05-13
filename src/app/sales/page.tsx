export const dynamic = 'force-dynamic'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { DEFAULT_ACCOUNT_ID } from '@/lib/stores'
import SalesClient from './SalesClient'

export const revalidate = 3600

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function addDays(d: string, n: number): string {
  const [y, mo, day] = d.split('-').map(Number)
  const dt = new Date(y, mo - 1, day + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function addYears(d: string, n: number): string {
  const [y, mo, day] = d.split('-').map(Number)
  return `${y + n}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

async function getSalesData(accountId: number | null, from: string, to: string) {
  const prevFrom = addYears(from, -1)
  const prevTo   = addYears(to,   -1)
  const fromJST  = from + 'T00:00:00+09:00'
  const toJST    = addDays(to, 1) + 'T00:00:00+09:00'

  function withStore(q: any) {
    return accountId !== null ? q.eq('account_id', accountId) : q
  }

  const [
    { data: dailyCurrent },
    { data: dailyPrev },
    { data: paymentRaw },
    { data: checkoutRaw },
    { data: earliestRow },
  ] = await Promise.all([
    withStore(supabase.from('v_daily_sales').select('*')
      .gte('sale_date', from).lte('sale_date', to)).order('sale_date'),
    withStore(supabase.from('v_daily_sales').select('sale_date,total,checkout_count,discount_amount')
      .gte('sale_date', prevFrom).lte('sale_date', prevTo)).order('sale_date'),
    withStore(supabase.from('v_payment_breakdown')
      .select('payment_type_name,payment_method,total_amount')
      .gte('sale_date', from).lte('sale_date', to)),
    withStore(supabase.from('ubiregi_checkouts')
      .select('paid_at,total,account_id')
      .eq('status', 'closed')
      .gte('paid_at', fromJST).lt('paid_at', toJST)
      .not('paid_at', 'is', null)
      .limit(3000)),
    withStore(supabase.from('v_monthly_sales').select('sale_month').order('sale_month').limit(1)),
  ])

  const sum = (rows: any[] | null, k: string) =>
    (rows ?? []).reduce((s: number, r: any) => s + (Number(r[k]) || 0), 0)

  const periodTotal    = sum(dailyCurrent, 'total')
  const periodCount    = sum(dailyCurrent, 'checkout_count')
  const periodDiscount = sum(dailyCurrent, 'discount_amount')
  const prevTotal      = sum(dailyPrev, 'total')
  const prevCount      = sum(dailyPrev, 'checkout_count')
  const yoyRevenue = prevTotal > 0 ? ((periodTotal - prevTotal) / prevTotal) * 100 : null
  const yoyCount   = prevCount > 0 ? ((periodCount - prevCount) / prevCount) * 100 : null

  // 支払方法
  const paymentMap: Record<string, number> = {}
  for (const p of paymentRaw ?? []) {
    const k = (p.payment_type_name ?? p.payment_method ?? '不明') as string
    paymentMap[k] = (paymentMap[k] ?? 0) + Number(p.total_amount ?? 0)
  }
  const paymentData = Object.entries(paymentMap)
    .filter(([, v]) => v > 0)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)

  // 曜日別集計 + 曜日×時間帯マトリクス
  const dowTotal = Array(7).fill(0); const dowCount = Array(7).fill(0)
  const hodTotal = Array(24).fill(0); const hodCount = Array(24).fill(0)
  const hodDowMatrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))

  for (const c of checkoutRaw ?? []) {
    if (!c.paid_at) continue
    const jst = new Date(new Date(c.paid_at).getTime() + 9 * 3600 * 1000)
    const d = jst.getDay(); const h = jst.getHours()
    dowTotal[d] += Number(c.total); dowCount[d]++
    hodTotal[h] += Number(c.total); hodCount[h]++
    hodDowMatrix[d][h] += Number(c.total)
  }
  const dowData = Array.from({ length: 7 },  (_, i) => ({ dow: i, label: DOW_LABELS[i], total: dowTotal[i], count: dowCount[i] }))
  const hodData = Array.from({ length: 24 }, (_, i) => ({ hour: i, total: hodTotal[i], count: hodCount[i] }))

  // 前年比マップ
  const prevDayMap: Record<string, number> = {}
  for (const d of dailyPrev ?? []) {
    prevDayMap[addYears(String(d.sale_date), 1)] = Number(d.total)
  }

  const earliestYear = earliestRow?.[0]?.sale_month
    ? new Date((earliestRow[0].sale_month as string) + 'T00:00:00').getFullYear()
    : 2016

  return {
    dailyCurrent: (dailyCurrent ?? []) as any[],
    prevDayMap,
    paymentData,
    dowData,
    hodData,
    hodDowMatrix,
    periodTotal,
    periodCount,
    periodDiscount,
    yoyRevenue,
    yoyCount,
    selectedFrom: from,
    selectedTo:   to,
    currentA:     accountId !== null ? String(accountId) : 'all',
    earliestYear,
  }
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params    = await searchParams
  const aParam    = Array.isArray(params.a)    ? params.a[0]    : params.a
  const fromParam = Array.isArray(params.from) ? params.from[0] : params.from
  const toParam   = Array.isArray(params.to)   ? params.to[0]   : params.to

  const accountId = aParam === 'all' ? null : aParam ? Number(aParam) : DEFAULT_ACCOUNT_ID

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const thisMonthStart = todayStr.substring(0, 7) + '-01'

  const from = fromParam ?? thisMonthStart
  const to   = toParam   ?? todayStr

  const data = await getSalesData(accountId, from, to)
  return <SalesClient {...data} />
}
