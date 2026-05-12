import { supabase } from '@/lib/supabase'
import SalesClient from './SalesClient'

async function getSalesData() {
  // 月別売上（直近12ヶ月）
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11)
  const fromMonth = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`

  const { data: monthlySales } = await supabase
    .from('v_monthly_sales')
    .select('*')
    .gte('sale_month', fromMonth)
    .order('sale_month', { ascending: true })

  // 支払方法別（直近30日）
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: paymentBreakdown } = await supabase
    .from('v_payment_breakdown')
    .select('payment_method, payment_type_name, total_amount')
    .gte('sale_date', thirtyDaysAgo.toISOString().split('T')[0])

  // 支払方法を集計
  const paymentMap: Record<string, number> = {}
  for (const p of paymentBreakdown ?? []) {
    const key = p.payment_type_name ?? p.payment_method ?? '不明'
    paymentMap[key] = (paymentMap[key] ?? 0) + (p.total_amount ?? 0)
  }
  const paymentData = Object.entries(paymentMap)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)

  return {
    monthlySales: monthlySales ?? [],
    paymentData,
  }
}

export default async function SalesPage() {
  const data = await getSalesData()
  return <SalesClient {...data} />
}
