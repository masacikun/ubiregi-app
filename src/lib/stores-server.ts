import 'server-only'
import { cache } from 'react'
import { supabaseAdmin } from './supabase-admin'
import { ACTIVE_STATUS, type StoreInfo } from './stores'

// stores テーブル（master-app 管轄の店舗マスタ）からユビレジ紐付きの店舗を取得。
// 稼働判定は status（'営業中'/'閉店'）を正とする。cache() で同一リクエスト内は1回だけ取得。
export const fetchStores = cache(async (): Promise<StoreInfo[]> => {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, ubiregi_account_id, current_name, status, closed_on, sort_order')
    .not('ubiregi_account_id', 'is', null)
    .order('sort_order')
    .order('id')
  if (error) throw new Error(`stores の取得に失敗: ${error.message}`)
  return (data ?? []).map(s => ({
    id: Number(s.id),
    accountId: Number(s.ubiregi_account_id),
    label: String(s.current_name),
    isActive: s.status === ACTIVE_STATUS,
    closedOn: (s.closed_on as string | null) ?? null,
  }))
})

export async function fetchActiveAccountIds(): Promise<number[]> {
  return (await fetchStores()).filter(s => s.isActive).map(s => s.accountId)
}
