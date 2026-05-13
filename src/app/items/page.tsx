import { supabaseServer as supabase } from '@/lib/supabase-server'
import { DEFAULT_ACCOUNT_ID } from '@/lib/stores'
import ItemsClient from './ItemsClient'

export const revalidate = 3600

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const HOD_RANGE  = [17, 18, 19, 20, 21, 22, 23, 0, 1]
const CHUNK      = 150
const PAGES      = 15
const PAGE_SIZE  = 1000

function addDays(d: string, n: number): string {
  const [y, mo, day] = d.split('-').map(Number)
  const dt = new Date(y, mo - 1, day + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function getSeason(month: number): { key: string; label: string } {
  if (month >= 3 && month <= 5)  return { key: 'spring', label: '春(3-5月)' }
  if (month >= 6 && month <= 8)  return { key: 'summer', label: '夏(6-8月)' }
  if (month >= 9 && month <= 11) return { key: 'fall',   label: '秋(9-11月)' }
  return { key: 'winter', label: '冬(12-2月)' }
}

type ItemEntry = {
  menu_item_id:   number | null
  menu_item_name: string
  category_id:    number | null
  category_name:  string | null
  total_quantity: number
  total_revenue:  number
}

function buildItemMap(results: { data: any[] | null }[]): Record<string, ItemEntry> {
  const map: Record<string, ItemEntry> = {}
  for (const { data } of results) {
    for (const row of data ?? []) {
      const key = String(row.menu_item_id ?? row.menu_item_name)
      if (!map[key]) {
        map[key] = {
          menu_item_id:   row.menu_item_id,
          menu_item_name: row.menu_item_name,
          category_id:    row.category_id,
          category_name:  row.category_name,
          total_quantity: 0,
          total_revenue:  0,
        }
      }
      map[key].total_quantity += Number(row.quantity  ?? 0)
      map[key].total_revenue  += Number(row.subtotal  ?? 0)
    }
  }
  return map
}

type TimeInfo = { dow: number; hour: number; month: number }

function computeTimeAnalysis(
  checkoutTimeMap: Record<number, TimeInfo>,
  itemResults: { data: any[] | null }[]
) {
  // ── Pairing ──
  const checkoutItemsGrouped: Record<number, string[]> = {}
  for (const { data } of itemResults) {
    for (const row of data ?? []) {
      const cid = Number(row.checkout_id)
      if (!checkoutItemsGrouped[cid]) checkoutItemsGrouped[cid] = []
      checkoutItemsGrouped[cid].push(String(row.menu_item_name))
    }
  }
  const pairCounts: Record<string, number> = {}
  for (const names of Object.values(checkoutItemsGrouped)) {
    const uniq = [...new Set(names)].slice(0, 20)
    if (uniq.length < 2) continue
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const pair = [uniq[i], uniq[j]].sort().join(' × ')
        pairCounts[pair] = (pairCounts[pair] ?? 0) + 1
      }
    }
  }
  const pairingData = Object.entries(pairCounts)
    .sort(([, a], [, b]) => b - a).slice(0, 20)
    .map(([pair, count]) => {
      const parts = pair.split(' × ')
      return { item1: parts[0] ?? '', item2: parts[1] ?? '', count }
    })

  // ── HOD popular items ──
  const hodItemMap: Record<number, Record<string, { name: string; quantity: number }>> = {}
  HOD_RANGE.forEach(h => { hodItemMap[h] = {} })

  for (const { data } of itemResults) {
    for (const row of data ?? []) {
      const cid = Number(row.checkout_id)
      const t   = checkoutTimeMap[cid]
      if (!t || !HOD_RANGE.includes(t.hour)) continue
      const h   = t.hour
      const key = String(row.menu_item_name)
      if (!hodItemMap[h][key]) hodItemMap[h][key] = { name: row.menu_item_name, quantity: 0 }
      hodItemMap[h][key].quantity += Number(row.quantity ?? 0)
    }
  }
  const hodTopItems = HOD_RANGE.map(h => ({
    hour:  h,
    items: Object.values(hodItemMap[h]).sort((a, b) => b.quantity - a.quantity).slice(0, 5),
  }))

  // ── DOW popular items ──
  const dowItemMap: Record<number, Record<string, { name: string; quantity: number }>> = {}
  Array.from({ length: 7 }, (_, i) => i).forEach(d => { dowItemMap[d] = {} })

  for (const { data } of itemResults) {
    for (const row of data ?? []) {
      const cid = Number(row.checkout_id)
      const t   = checkoutTimeMap[cid]
      if (!t) continue
      const d   = t.dow
      const key = String(row.menu_item_name)
      if (!dowItemMap[d][key]) dowItemMap[d][key] = { name: row.menu_item_name, quantity: 0 }
      dowItemMap[d][key].quantity += Number(row.quantity ?? 0)
    }
  }
  const dowTopItems = Array.from({ length: 7 }, (_, i) => i).map(d => ({
    dow:   d,
    label: DOW_LABELS[d],
    items: Object.values(dowItemMap[d]).sort((a, b) => b.quantity - a.quantity).slice(0, 5),
  }))

  // ── Seasonal breakdown ──
  const seasonMap: Record<string, { label: string; total: number; items: Record<string, { name: string; rev: number }> }> = {}
  for (const { data } of itemResults) {
    for (const row of data ?? []) {
      const cid = Number(row.checkout_id)
      const t   = checkoutTimeMap[cid]
      if (!t) continue
      const s   = getSeason(t.month)
      if (!seasonMap[s.key]) seasonMap[s.key] = { label: s.label, total: 0, items: {} }
      seasonMap[s.key].total += Number(row.subtotal ?? 0)
      const key = String(row.menu_item_name)
      if (!seasonMap[s.key].items[key]) seasonMap[s.key].items[key] = { name: row.menu_item_name, rev: 0 }
      seasonMap[s.key].items[key].rev += Number(row.subtotal ?? 0)
    }
  }
  const SEASON_ORDER = ['spring', 'summer', 'fall', 'winter']
  const seasonalData = Object.entries(seasonMap)
    .map(([key, v]) => ({
      key, label: v.label, total: v.total,
      items: Object.values(v.items).sort((a, b) => b.rev - a.rev).slice(0, 5),
    }))
    .sort((a, b) => SEASON_ORDER.indexOf(a.key) - SEASON_ORDER.indexOf(b.key))

  return { pairingData, hodTopItems, dowTopItems, seasonalData }
}

async function getItemsData(accountId: number | null, from: string | null, to: string | null) {
  function withStore(q: any) {
    return accountId !== null ? q.eq('account_id', accountId) : q
  }

  if (from && to) {
    // ─── 期間指定モード ───
    const fromJST = from + 'T00:00:00+09:00'
    const toJST   = addDays(to, 1) + 'T00:00:00+09:00'

    const [p1, p2] = await Promise.all([
      withStore(supabase.from('ubiregi_checkouts')
        .select('id,paid_at').eq('status', 'closed')
        .gte('paid_at', fromJST).lt('paid_at', toJST)
      ).order('id', { ascending: false }).range(0, 999),
      withStore(supabase.from('ubiregi_checkouts')
        .select('id,paid_at').eq('status', 'closed')
        .gte('paid_at', fromJST).lt('paid_at', toJST)
      ).order('id', { ascending: false }).range(1000, 1999),
    ])

    const checkouts: { id: number; paid_at: string }[] = [
      ...(p1.data ?? []) as any[],
      ...(p2.data ?? []) as any[],
    ]
    if (checkouts.length === 0) {
      return { ranking: [], rowsFetched: 0, isPeriodFiltered: true, pairingData: [], hodTopItems: [], dowTopItems: [], seasonalData: [] }
    }

    const checkoutIds = checkouts.map(c => c.id)
    const checkoutTimeMap: Record<number, TimeInfo> = {}
    for (const c of checkouts) {
      if (!c.paid_at) continue
      const jst = new Date(new Date(c.paid_at).getTime() + 9 * 3600 * 1000)
      checkoutTimeMap[c.id] = { dow: jst.getDay(), hour: jst.getHours(), month: jst.getMonth() + 1 }
    }

    const chunks: number[][] = []
    for (let i = 0; i < checkoutIds.length; i += CHUNK) chunks.push(checkoutIds.slice(i, i + CHUNK))

    const itemResults = await Promise.all(
      chunks.map(chunk =>
        withStore(supabase.from('ubiregi_checkout_items')
          .select('checkout_id,menu_item_id,menu_item_name,category_id,category_name,quantity,subtotal')
        ).in('checkout_id', chunk)
      )
    )

    const itemMap     = buildItemMap(itemResults)
    const ranking     = Object.values(itemMap).sort((a, b) => b.total_revenue - a.total_revenue)
    const rowsFetched = itemResults.reduce((s, { data }: any) => s + (data?.length ?? 0), 0)
    const timeAnalysis = computeTimeAnalysis(checkoutTimeMap, itemResults)

    return { ranking, rowsFetched, isPeriodFiltered: true, ...timeAnalysis }
  }

  // ─── 全期間モード ───
  // メインランキング: 最新15,000件
  const pageResults = await Promise.all(
    Array.from({ length: PAGES }, (_, i) =>
      withStore(supabase.from('ubiregi_checkout_items')
        .select('menu_item_id,menu_item_name,category_id,category_name,quantity,subtotal')
      ).order('checkout_id', { ascending: false }).range(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1)
    )
  )
  const itemMap     = buildItemMap(pageResults)
  const ranking     = Object.values(itemMap).sort((a, b) => b.total_revenue - a.total_revenue)
  const rowsFetched = pageResults.reduce((s, { data }: any) => s + (data?.length ?? 0), 0)

  // 時系列分析: 直近300会計
  const { data: recentCheckouts } = await withStore(supabase.from('ubiregi_checkouts')
    .select('id,paid_at').eq('status', 'closed').not('paid_at', 'is', null)
  ).order('id', { ascending: false }).range(0, 299)

  const recentIds = (recentCheckouts ?? []).map((c: any) => c.id as number)
  const checkoutTimeMap: Record<number, TimeInfo> = {}
  for (const c of recentCheckouts ?? []) {
    if (!c.paid_at) continue
    const jst = new Date(new Date(c.paid_at).getTime() + 9 * 3600 * 1000)
    checkoutTimeMap[(c as any).id] = { dow: jst.getDay(), hour: jst.getHours(), month: jst.getMonth() + 1 }
  }

  const timeChunks = []
  for (let i = 0; i < recentIds.length; i += CHUNK) timeChunks.push(recentIds.slice(i, i + CHUNK))

  let timeAnalysis = { pairingData: [] as any[], hodTopItems: [] as any[], dowTopItems: [] as any[], seasonalData: [] as any[] }
  if (timeChunks.length > 0) {
    const timeItemResults = await Promise.all(
      timeChunks.map(chunk =>
        withStore(supabase.from('ubiregi_checkout_items')
          .select('checkout_id,menu_item_name,quantity,subtotal')
        ).in('checkout_id', chunk)
      )
    )
    timeAnalysis = computeTimeAnalysis(checkoutTimeMap, timeItemResults)
  }

  return { ranking, rowsFetched, isPeriodFiltered: false, ...timeAnalysis }
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params    = await searchParams
  const aParam    = Array.isArray(params.a)    ? params.a[0]    : params.a
  const fromParam = Array.isArray(params.from) ? params.from[0] : params.from
  const toParam   = Array.isArray(params.to)   ? params.to[0]   : params.to
  const accountId = aParam === 'all' ? null : aParam ? Number(aParam) : DEFAULT_ACCOUNT_ID

  const data = await getItemsData(accountId, fromParam ?? null, toParam ?? null)

  return (
    <ItemsClient
      ranking={data.ranking}
      rowsFetched={data.rowsFetched}
      isPeriodFiltered={data.isPeriodFiltered}
      selectedFrom={fromParam ?? null}
      selectedTo={toParam ?? null}
      currentA={accountId !== null ? String(accountId) : 'all'}
      pairingData={data.pairingData}
      hodTopItems={data.hodTopItems}
      dowTopItems={data.dowTopItems}
      seasonalData={data.seasonalData}
    />
  )
}
