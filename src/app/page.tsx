import { supabase } from '@/lib/supabase'
import DashboardClient from './DashboardClient'

async function getDashboardData() {
  const today = new Date()
  const thisMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`

  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]

  const [
    { data: dailySales },
    { data: thisMonthData },
    { data: lastMonthData },
    { data: topItems },
  ] = await Promise.all([
    supabase.from('v_daily_sales').select('*').gte('sale_date', thirtyDaysAgoStr).order('sale_date'),
    supabase.from('v_daily_sales').select('total, checkout_count, discount_amount').gte('sale_date', thisMonthStr),
    supabase.from('v_daily_sales').select('total').gte('sale_date', lastMonthStr).lt('sale_date', thisMonthStr),
    supabase.from('v_item_sales_ranking').select('*').order('total_revenue', { ascending: false }).limit(5),
  ])

  const thisMonthTotal    = thisMonthData?.reduce((s, r) => s + (r.total ?? 0), 0) ?? 0
  const thisMonthCount    = thisMonthData?.reduce((s, r) => s + (r.checkout_count ?? 0), 0) ?? 0
  const thisMonthDiscount = thisMonthData?.reduce((s, r) => s + (r.discount_amount ?? 0), 0) ?? 0
  const lastMonthTotal    = lastMonthData?.reduce((s, r) => s + (r.total ?? 0), 0) ?? 0
  const momRate = lastMonthTotal > 0
    ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100
    : null

  return {
    dailySales:         dailySales ?? [],
    thisMonthTotal,
    thisMonthCount,
    thisMonthDiscount,
    momRate,
    topItems:           topItems ?? [],
    thisMonthSaleDate:  thisMonthStr,
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()
  return <DashboardClient {...data} />
}
