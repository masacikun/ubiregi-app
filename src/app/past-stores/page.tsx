export const metadata = { title: '過去店舗' }
export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { fetchStores } from '@/lib/stores-server'
import type { StoreInfo } from '@/lib/stores'

export const revalidate = 3600

type StoreSummary = {
  store: StoreInfo
  totalSales: number
  totalCheckouts: number
  firstMonth: string | null
  lastMonth: string | null
}

function yen(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}

function ym(d: string | null) {
  if (!d) return '—'
  const [y, m] = d.split('-')
  return `${y}年${Number(m)}月`
}

function ymd(d: string) {
  const [y, m, day] = d.split('-')
  return `${y}年${Number(m)}月${Number(day)}日`
}

// v_monthly_sales（月次集計ビュー）から累計・稼働期間を算出（分析ロジックの二重実装はしない）
async function getSummary(store: StoreInfo): Promise<StoreSummary> {
  const { data } = await supabase
    .from('v_monthly_sales')
    .select('sale_month,total,checkout_count')
    .eq('account_id', store.accountId)
    .order('sale_month')
  const rows = data ?? []
  return {
    store,
    totalSales:     rows.reduce((s, r) => s + Number(r.total ?? 0), 0),
    totalCheckouts: rows.reduce((s, r) => s + Number(r.checkout_count ?? 0), 0),
    firstMonth:     rows.length ? String(rows[0].sale_month) : null,
    lastMonth:      rows.length ? String(rows[rows.length - 1].sale_month) : null,
  }
}

export default async function PastStoresPage() {
  const stores = await fetchStores()
  const pastStores = stores.filter(s => !s.isActive)
  const summaries = await Promise.all(pastStores.map(getSummary))

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-700 p-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-gray-100">過去店舗</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          閉店した店舗の一覧（参照専用）。各店舗の分析画面へは下のリンクから移動できます。
        </p>
      </div>

      {summaries.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-700 p-6 text-sm text-slate-500 dark:text-gray-400">
          閉店店舗はありません。
        </div>
      )}

      {summaries.map(({ store, totalSales, totalCheckouts, firstMonth, lastMonth }) => (
        <div
          key={store.id}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-700 p-6"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-slate-800 dark:text-gray-100">{store.label}</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  閉店{store.closedOn ? `（${ymd(store.closedOn)}）` : ''}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                データ期間: {ym(firstMonth)} 〜 {ym(lastMonth)}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link
                href={`/?a=${store.accountId}`}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors"
              >
                ダッシュボード
              </Link>
              <Link
                href={`/sales?a=${store.accountId}`}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors"
              >
                売上分析
              </Link>
              <Link
                href={`/items?a=${store.accountId}`}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors"
              >
                商品分析
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4">
              <p className="text-xs text-slate-400">累計売上（税込）</p>
              <p className="text-xl font-bold text-slate-800 dark:text-gray-100 mt-1">{yen(totalSales)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4">
              <p className="text-xs text-slate-400">累計会計数</p>
              <p className="text-xl font-bold text-slate-800 dark:text-gray-100 mt-1">{totalCheckouts.toLocaleString('ja-JP')}件</p>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4">
              <p className="text-xs text-slate-400">平均客単価</p>
              <p className="text-xl font-bold text-slate-800 dark:text-gray-100 mt-1">
                {totalCheckouts > 0 ? yen(Math.round(totalSales / totalCheckouts)) : '—'}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
