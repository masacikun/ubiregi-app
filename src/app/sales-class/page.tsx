export const metadata = { title: '売上区分マッピング' }
export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchStores } from '@/lib/stores-server'
import SalesClassClient, {
  type StoreTab, type CategoryRow, type ProductRow, type SalesClass,
} from './SalesClassClient'

// 直近90日の実売から商品一覧を組み立てる（マスタ全件ではなく「実際に売れた商品」を対象にする）
const LOOKBACK_DAYS = 90

// PostgREST は1リクエスト最大1000行のため range でページング（generate_journal_drafts.mjs と同じ方式）
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  return out
}

type ItemLine = {
  menu_item_id: number | null
  menu_item_name: string
  category_name: string | null
  quantity: number
  subtotal: number
  ubiregi_checkouts: { paid_at: string }
}

async function getData(accountId: number) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString()

  const [catRes, ovRes, lines] = await Promise.all([
    supabaseAdmin
      .from('ubiregi_category_map')
      .select('id, account_id, category_name, sales_class, needs_review, memo, is_active')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('sales_class')
      .order('category_name'),
    supabaseAdmin
      .from('ubiregi_product_category_overrides')
      .select('account_id, menu_item_id, menu_item_name, category_name, sales_class, is_active, note')
      .eq('account_id', accountId),
    fetchAll<ItemLine>((from, to) =>
      supabaseAdmin
        .from('ubiregi_checkout_items')
        .select('menu_item_id, menu_item_name, category_name, quantity, subtotal, ubiregi_checkouts!inner(paid_at, status)')
        .eq('account_id', accountId)
        .eq('ubiregi_checkouts.status', 'closed')
        .gte('ubiregi_checkouts.paid_at', since)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: ItemLine[] | null; error: { message: string } | null }>,
    ),
  ])
  if (catRes.error) throw new Error(catRes.error.message)
  if (ovRes.error) throw new Error(ovRes.error.message)

  const catDefault = new Map<string, SalesClass>(
    (catRes.data ?? []).map(c => [c.category_name as string, c.sales_class as SalesClass]),
  )
  const activeOverrides = new Map<number, { sales_class: SalesClass; note: string | null }>(
    (ovRes.data ?? [])
      .filter(o => o.is_active && o.menu_item_id != null)
      .map(o => [Number(o.menu_item_id), { sales_class: o.sales_class as SalesClass, note: (o.note as string | null) ?? null }]),
  )

  // 商品単位に集約（表示名・カテゴリは直近の明細を採用）
  type Agg = { name: string; category: string | null; qty: number; subtotal: number; lastPaidAt: string }
  const byItem = new Map<number, Agg>()
  for (const l of lines) {
    if (l.menu_item_id == null) continue // 防御的: 現状は全明細に存在（Phase 0 で NULL ゼロ確認）
    const id = Number(l.menu_item_id)
    const paidAt = l.ubiregi_checkouts?.paid_at ?? ''
    const cur = byItem.get(id)
    if (!cur) {
      byItem.set(id, { name: l.menu_item_name, category: l.category_name, qty: Number(l.quantity), subtotal: Number(l.subtotal), lastPaidAt: paidAt })
    } else {
      cur.qty += Number(l.quantity)
      cur.subtotal += Number(l.subtotal)
      if (paidAt > cur.lastPaidAt) {
        cur.lastPaidAt = paidAt
        cur.name = l.menu_item_name
        cur.category = l.category_name
      }
    }
  }

  const products: ProductRow[] = [...byItem.entries()]
    .map(([menuItemId, a]) => {
      const defaultClass = a.category != null ? (catDefault.get(a.category) ?? null) : null
      const ov = activeOverrides.get(menuItemId) ?? null
      return {
        menuItemId,
        name: a.name,
        categoryName: a.category,
        defaultClass,                                  // null = カテゴリ未マッピング（生成時は other + 要確認）
        override: ov?.sales_class ?? null,
        note: ov?.note ?? null,
        qty: Math.round(a.qty * 10) / 10,
        subtotal: Math.round(a.subtotal),
      }
    })
    .sort((x, y) => (x.categoryName ?? '').localeCompare(y.categoryName ?? '', 'ja') || x.name.localeCompare(y.name, 'ja'))

  // カテゴリ行: category_map 全行 ＋ 実売にあるが未登録のカテゴリ（警告表示用）
  const productCountByCat = new Map<string, number>()
  for (const p of products) {
    if (p.categoryName == null) continue
    productCountByCat.set(p.categoryName, (productCountByCat.get(p.categoryName) ?? 0) + 1)
  }
  const categories: CategoryRow[] = (catRes.data ?? []).map(c => ({
    categoryName: c.category_name as string,
    salesClass: c.sales_class as SalesClass,
    memo: (c.memo as string | null) ?? null,
    productCount: productCountByCat.get(c.category_name as string) ?? 0,
    unmapped: false,
  }))
  for (const [cat, count] of productCountByCat) {
    if (!catDefault.has(cat)) {
      categories.push({ categoryName: cat, salesClass: null, memo: null, productCount: count, unmapped: true })
    }
  }

  return { categories, products }
}

export default async function SalesClassPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const a = typeof params.a === 'string' ? params.a : undefined

  // MF送信対象の店 = unit_pos_mappings（pos_type=ubiregi）に紐付く店のみ（Phase 0 時点: 中洲19023・西新42765）
  const [{ data: upm, error: upmErr }, stores] = await Promise.all([
    supabaseAdmin.from('unit_pos_mappings').select('external_id').eq('pos_type', 'ubiregi'),
    fetchStores(),
  ])
  if (upmErr) throw new Error(upmErr.message)
  const mappedIds = new Set((upm ?? []).map(m => Number(m.external_id)))
  const tabs: StoreTab[] = stores
    .filter(s => mappedIds.has(s.accountId))
    .map(s => ({ accountId: s.accountId, label: s.label }))
  if (tabs.length === 0) throw new Error('unit_pos_mappings にユビレジ店舗がありません')

  const requested = Number(a)
  const accountId = tabs.some(t => t.accountId === requested) ? requested : tabs[0].accountId

  const { categories, products } = await getData(accountId)

  return (
    <SalesClassClient
      tabs={tabs}
      accountId={accountId}
      categories={categories}
      products={products}
    />
  )
}
