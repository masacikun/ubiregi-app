export const metadata = { title: '番頭さん｜ユビレジ分析｜ダッシュボード' }
export const dynamic = 'force-dynamic'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { DEFAULT_ACCOUNT_ID } from '@/lib/stores'
import DashboardClient from './DashboardClient'

export const revalidate = 3600

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function pad(n: number) { return String(n).padStart(2, '0') }
function monthStart(y: number, m: number) { return `${y}-${pad(m)}-01` }
function monthEnd(y: number, m: number) {
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
}

async function getDashboardData(accountId: number | null, year: number, month: number) {
  const pStart  = monthStart(year, month)
  const pEnd    = monthEnd(year, month)
  const pm      = month === 1 ? 12 : month - 1
  const py      = month === 1 ? year - 1 : year
  const pmStart = monthStart(py, pm)

  const jstNow      = new Date(Date.now() + 9 * 3600 * 1000)
  const jstToday    = jstNow.toISOString().split('T')[0]
  const jst30Ago    = new Date(jstNow.getTime() - 29 * 24 * 3600 * 1000)
  const tomorrowJST = new Date(jstNow.getTime() + 24 * 3600 * 1000)
  const d30JST      = jst30Ago.toISOString().split('T')[0] + 'T00:00:00+09:00'
  const tmrwJST     = tomorrowJST.toISOString().split('T')[0] + 'T00:00:00+09:00'

  // 前年同期30日
  const prev30Start = new Date(jst30Ago.getTime() - 365 * 24 * 3600 * 1000)
    .toISOString().split('T')[0] + 'T00:00:00+09:00'
  const prev30End   = new Date(tomorrowJST.getTime() - 365 * 24 * 3600 * 1000)
    .toISOString().split('T')[0] + 'T00:00:00+09:00'

  function withStore(q: any) {
    return accountId !== null ? q.eq('account_id', accountId) : q
  }

  const [
    { data: monthDaily },
    { data: prevMonthData },
    { data: prevYearData },
    { data: yearMonthly },
    { data: last30Raw },
    { data: prev30Raw },
    { data: paymentRaw },
    { data: earliestRow },
    { data: items1 },
    { data: items2 },
    { data: items3 },
  ] = await Promise.all([
    withStore(supabase.from('v_daily_sales').select('*')
      .gte('sale_date', pStart).lt('sale_date', pEnd)).order('sale_date'),
    withStore(supabase.from('v_daily_sales').select('total,checkout_count,discount_amount')
      .gte('sale_date', pmStart).lt('sale_date', pStart)),
    withStore(supabase.from('v_daily_sales').select('total,checkout_count')
      .gte('sale_date', monthStart(year - 1, month)).lt('sale_date', monthEnd(year - 1, month))),
    withStore(supabase.from('v_monthly_sales').select('sale_month,total,checkout_count,discount_amount')
      .gte('sale_month', `${year}-01-01`).lte('sale_month', pStart)).order('sale_month'),
    withStore(supabase.from('ubiregi_checkouts')
      .select('paid_at,total,account_id')
      .eq('status', 'closed')
      .gte('paid_at', d30JST).lt('paid_at', tmrwJST)
      .not('paid_at', 'is', null).limit(3000)),
    withStore(supabase.from('ubiregi_checkouts')
      .select('paid_at,total,account_id')
      .eq('status', 'closed')
      .gte('paid_at', prev30Start).lt('paid_at', prev30End)
      .not('paid_at', 'is', null).limit(3000)),
    withStore(supabase.from('v_payment_breakdown')
      .select('payment_type_name,payment_method,total_amount')
      .gte('sale_date', pStart).lt('sale_date', pEnd)),
    withStore(supabase.from('v_monthly_sales').select('sale_month').order('sale_month').limit(1)),
    withStore(supabase.from('ubiregi_checkout_items')
      .select('menu_item_id,menu_item_name,category_id,category_name,quantity,subtotal')
    ).order('checkout_id', { ascending: false }).range(0, 999),
    withStore(supabase.from('ubiregi_checkout_items')
      .select('menu_item_id,menu_item_name,category_id,category_name,quantity,subtotal')
    ).order('checkout_id', { ascending: false }).range(1000, 1999),
    withStore(supabase.from('ubiregi_checkout_items')
      .select('menu_item_id,menu_item_name,category_id,category_name,quantity,subtotal')
    ).order('checkout_id', { ascending: false }).range(2000, 2999),
  ])

  const sum = (rows: any[] | null, k: string) =>
    (rows ?? []).reduce((s: number, r: any) => s + (Number(r[k]) || 0), 0)

  const periodTotal    = sum(monthDaily, 'total')
  const periodCount    = sum(monthDaily, 'checkout_count')
  const periodDiscount = sum(monthDaily, 'discount_amount')
  const prevTotal      = sum(prevMonthData, 'total')
  const prevCount      = sum(prevMonthData, 'checkout_count')
  const prevYearTotal  = sum(prevYearData, 'total')

  const momRevenue  = prevTotal     > 0 ? ((periodTotal - prevTotal)     / prevTotal)     * 100 : null
  const yoyRevenue  = prevYearTotal > 0 ? ((periodTotal - prevYearTotal) / prevYearTotal) * 100 : null
  const momCount    = prevCount     > 0 ? ((periodCount - prevCount)     / prevCount)     * 100 : null
  const avgCheckout = periodCount   > 0 ? Math.round(periodTotal / periodCount) : 0
  const prevAvg     = prevCount     > 0 ? Math.round(prevTotal   / prevCount)   : 0
  const momAvg      = prevAvg       > 0 ? ((avgCheckout - prevAvg) / prevAvg) * 100 : null
  const yearCumulative = sum(yearMonthly, 'total')

  const bestDayRow = (monthDaily ?? []).reduce((best: any, r: any) =>
    Number(r.total) > Number(best?.total ?? 0) ? r : best, null)

  // 直近30日 日別集計
  const last30Map: Record<string, { total: number; count: number }> = {}
  for (const c of last30Raw ?? []) {
    if (!c.paid_at) continue
    const jst = new Date(new Date(c.paid_at).getTime() + 9 * 3600 * 1000)
    const ds  = `${jst.getFullYear()}-${pad(jst.getMonth() + 1)}-${pad(jst.getDate())}`
    if (!last30Map[ds]) last30Map[ds] = { total: 0, count: 0 }
    last30Map[ds].total += Number(c.total)
    last30Map[ds].count++
  }
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const d  = new Date(jstNow.getTime() - (29 - i) * 24 * 3600 * 1000)
    const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return { date: ds, total: last30Map[ds]?.total ?? 0, count: last30Map[ds]?.count ?? 0 }
  })

  // 直近30日 昨対比
  const last30Total  = last30Days.reduce((s, d) => s + d.total, 0)
  const prev30Total  = (prev30Raw ?? []).reduce((s: number, c: any) => s + Number(c.total || 0), 0)
  const yoyLast30    = prev30Total > 0 ? ((last30Total - prev30Total) / prev30Total) * 100 : null

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

  // 曜日 / 時間帯
  const dowTotal = Array(7).fill(0); const dowCount = Array(7).fill(0)
  const hodTotal = Array(24).fill(0); const hodCount = Array(24).fill(0)
  for (const c of last30Raw ?? []) {
    if (!c.paid_at) continue
    const jst = new Date(new Date(c.paid_at).getTime() + 9 * 3600 * 1000)
    const d = jst.getDay(); const h = jst.getHours()
    dowTotal[d] += Number(c.total); dowCount[d]++
    hodTotal[h] += Number(c.total); hodCount[h]++
  }
  const dowData = Array.from({ length: 7 },  (_, i) => ({ dow: i, label: DOW_LABELS[i], total: dowTotal[i], count: dowCount[i] }))
  const hodData = Array.from({ length: 24 }, (_, i) => ({ hour: i, total: hodTotal[i], count: hodCount[i] }))

  // 売上ランキング TOP30（カテゴリタブ用）
  const itemMap: Record<string, { name: string; category: string; revenue: number; quantity: number }> = {}
  for (const rows of [items1, items2, items3]) {
    for (const r of rows ?? []) {
      const key = String(r.menu_item_id ?? r.menu_item_name)
      if (!itemMap[key]) itemMap[key] = { name: r.menu_item_name, category: r.category_name ?? '', revenue: 0, quantity: 0 }
      itemMap[key].revenue  += Number(r.subtotal  ?? 0)
      itemMap[key].quantity += Number(r.quantity  ?? 0)
    }
  }
  const sortedItems    = Object.values(itemMap).sort((a, b) => b.revenue - a.revenue)
  const topItems       = sortedItems.slice(0, 30)
  const topItemsTotal  = sortedItems.reduce((s, i) => s + i.revenue, 0)

  const earliestYear = earliestRow?.[0]?.sale_month
    ? new Date((earliestRow[0].sale_month as string) + 'T00:00:00').getFullYear()
    : 2016
  const currentYear  = new Date().getFullYear()
  const availableYears = Array.from({ length: currentYear - earliestYear + 1 }, (_, i) => currentYear - i)

  return {
    monthDaily:      (monthDaily  ?? []) as Record<string, unknown>[],
    yearMonthly:     (yearMonthly ?? []) as Record<string, unknown>[],
    paymentData,
    dowData,
    hodData,
    last30Days,
    topItems,
    topItemsTotal,
    periodTotal,
    periodCount,
    periodDiscount,
    prevTotal,
    prevYearTotal,
    momRevenue,
    yoyRevenue,
    momCount,
    avgCheckout,
    momAvg,
    yearCumulative,
    yoyLast30,
    bestDay: bestDayRow ? { date: String(bestDayRow.sale_date), total: Number(bestDayRow.total) } : null,
    selectedYear:    year,
    selectedMonth:   month,
    availableYears,
    currentA:        accountId !== null ? String(accountId) : 'all',
    jstToday,
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params    = await searchParams
  const aParam    = Array.isArray(params.a) ? params.a[0] : params.a
  const yParam    = Array.isArray(params.y) ? params.y[0] : params.y
  const mParam    = Array.isArray(params.m) ? params.m[0] : params.m
  const accountId = aParam === 'all' ? null : aParam ? Number(aParam) : DEFAULT_ACCOUNT_ID
  const today     = new Date()
  const year      = yParam ? Number(yParam) : today.getFullYear()
  const month     = mParam ? Number(mParam) : today.getMonth() + 1
  const data      = await getDashboardData(accountId, year, month)
  return <DashboardClient {...data} />
}
