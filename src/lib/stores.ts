export const STORES = [
  { id: 19023, label: '中洲店' },
  { id: 41741, label: 'もつ鍋大和' },
  { id: 30345, label: '大和天神店' },
] as const satisfies ReadonlyArray<{ id: number; label: string }>

export type StoreId = (typeof STORES)[number]['id']

export const ALL_LABEL = '全店舗合計'
export const DEFAULT_ACCOUNT_ID = 19023

export function getStoreLabel(id: number | null): string {
  if (id === null) return ALL_LABEL
  return STORES.find(s => s.id === id)?.label ?? `店舗 ${id}`
}
