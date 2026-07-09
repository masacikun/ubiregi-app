// 店舗マスタは DB の stores テーブルが正（取得は lib/stores-server.ts の fetchStores）。
// 稼働判定は stores.status = ACTIVE_STATUS を正とする（is_active カラムは新設しない・master-app と同一セマンティクス）。
export const ACTIVE_STATUS = '営業中'

export const ALL_LABEL = '稼働店合計'

export type StoreInfo = {
  id: number              // stores.id
  accountId: number       // stores.ubiregi_account_id（ubiregi_checkouts.account_id と対応）
  label: string           // stores.current_name
  isActive: boolean       // stores.status === ACTIVE_STATUS
  closedOn: string | null // stores.closed_on（未登録は null・バッジは「閉店」のみ表示）
}

export function getStoreLabel(stores: StoreInfo[], accountId: number | null): string {
  if (accountId === null) return ALL_LABEL
  return stores.find(s => s.accountId === accountId)?.label ?? `店舗 ${accountId}`
}

// セレクタの選択肢: 稼働店のみ列挙。ただし URL で明示指定中の閉店店舗は
// 「（閉店）」付きで末尾に含める（過去店舗ドリルダウン時に選択状態を表示するため）
export function storeOptionsFor(
  stores: StoreInfo[],
  currentA: string,
): { id: string; label: string }[] {
  const opts = [
    { id: 'all', label: ALL_LABEL },
    ...stores.filter(s => s.isActive).map(s => ({ id: String(s.accountId), label: s.label })),
  ]
  if (currentA !== 'all' && !opts.some(o => o.id === currentA)) {
    const closed = stores.find(s => String(s.accountId) === currentA)
    if (closed) opts.push({ id: String(closed.accountId), label: `${closed.label}（閉店）` })
  }
  return opts
}

// URL の a パラメータ → account_id。無指定/'all' は null（= 稼働店合計）
export function parseAccountParam(aParam: string | undefined): number | null {
  if (!aParam || aParam === 'all') return null
  const n = Number(aParam)
  return Number.isFinite(n) ? n : null
}
