'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendDraftAction } from './actions'

export type DraftRow = {
  id: number
  business_date: string
  account_id: number
  store_name: string
  department_code: string
  total_debit: number
  consumption_tax_amount: number
  total_credit: number
  checkout_count: number | null
  review_required: boolean
  review_reasons: string[]
  send_status: string
  mf_journal_id: string | null
  generated_at: string
}
export type DraftLine = {
  draft_id: number
  side: 'debit' | 'credit'
  account_name: string
  sub_account_name: string | null
  trade_partner_name: string | null
  tax_rate: number | null
  amount: number
  sort_order: number | null
  memo: string | null
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

type StatusKey = 'sent' | 'sendable' | 'review'
function statusOf(d: DraftRow): StatusKey {
  if (d.send_status === 'sent') return 'sent'
  if (d.review_required) return 'review'
  return 'sendable'
}

function Badge({ status, d }: { status: StatusKey; d: DraftRow }) {
  if (status === 'sent')
    return <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">送信済み</span>
  if (status === 'review')
    return (
      <span
        className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
        title={`要確認（4-2で対応予定）: ${d.review_reasons.join(' / ')}`}
      >
        要確認
      </span>
    )
  if (d.send_status === 'error')
    return <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">エラー（再送可）</span>
  return <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">送信可</span>
}

export default function MfSendClient({ drafts, lines, deptNames }: { drafts: DraftRow[]; lines: DraftLine[]; deptNames: Record<string, string> }) {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<'all' | StatusKey>('all')
  const [storeFilter, setStoreFilter] = useState<'all' | number>('all')
  const [monthFilter, setMonthFilter] = useState<'all' | string>('all')
  const [preview, setPreview] = useState<DraftRow | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  const linesByDraft = useMemo(() => {
    const m = new Map<number, DraftLine[]>()
    for (const l of lines) {
      if (!m.has(l.draft_id)) m.set(l.draft_id, [])
      m.get(l.draft_id)!.push(l)
    }
    return m
  }, [lines])

  const stores = useMemo(() => {
    const m = new Map<number, string>()
    for (const d of drafts) m.set(d.account_id, d.store_name)
    return [...m.entries()]
  }, [drafts])
  const months = useMemo(() => [...new Set(drafts.map(d => d.business_date.slice(0, 7)))].sort(), [drafts])

  const filtered = useMemo(() => {
    const rows = drafts.filter(d =>
      (statusFilter === 'all' || statusOf(d) === statusFilter) &&
      (storeFilter === 'all' || d.account_id === storeFilter) &&
      (monthFilter === 'all' || d.business_date.startsWith(monthFilter)),
    )
    // 未送信（送信可→要確認）を上に、その中で日付降順
    const rank = (d: DraftRow) => ({ sendable: 0, review: 1, sent: 2 }[statusOf(d)])
    return rows.sort((a, b) => rank(a) - rank(b) || b.business_date.localeCompare(a.business_date) || a.department_code.localeCompare(b.department_code))
  }, [drafts, statusFilter, storeFilter, monthFilter])

  const summary = useMemo(() => {
    let sentAmt = 0, unsentAmt = 0, reviewDays = 0
    for (const d of filtered) {
      const st = statusOf(d)
      if (st === 'sent') sentAmt += d.total_debit
      else unsentAmt += d.total_debit
      if (st === 'review') reviewDays++
    }
    return { sentAmt, unsentAmt, reviewDays }
  }, [filtered])

  function doSend(d: DraftRow) {
    startTransition(async () => {
      const res = await sendDraftAction(d.id)
      setToast(res)
      setPreview(null)
      if (res.ok) router.refresh()
      setTimeout(() => setToast(null), 6000)
    })
  }

  const sel = 'rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm'

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold mb-1">MF送信（ユビレジ売上 日次仕訳）</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        借方=現金/売掛金（<b>税込</b>・部門・取引先）／貸方=売上高（<b>税抜</b>・税率別・部門）。送信できるのはクリーンな日（要確認なし）のみ。
      </p>

      {/* フィルタ */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select className={sel} value={statusFilter} onChange={e => setStatusFilter(e.target.value as never)}>
          <option value="all">全状態</option>
          <option value="sendable">未送信（送信可）</option>
          <option value="review">要確認</option>
          <option value="sent">送信済み</option>
        </select>
        <select className={sel} value={String(storeFilter)} onChange={e => setStoreFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">全店舗</option>
          {stores.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className={sel} value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
          <option value="all">全期間</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* 集計ヘッダ */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">送信済み金額（税込）</div>
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{yen(summary.sentAmt)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">未送信金額（税込）</div>
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{yen(summary.unsentAmt)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">要確認の日数</div>
          <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{summary.reviewDays}日</div>
        </div>
      </div>

      {filtered.every(d => statusOf(d) !== 'sendable') && (
        <div className="mb-4 rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          送信可能な未送信の日はありません（クリーンな日はすべて送信済みです）。
        </div>
      )}

      {/* 一覧 */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 dark:bg-slate-800 text-left">
            <tr>
              <th className="px-3 py-2">営業日</th>
              <th className="px-3 py-2">店舗</th>
              <th className="px-3 py-2">部門</th>
              <th className="px-3 py-2 text-right">金額（税込）</th>
              <th className="px-3 py-2 text-right">会計数</th>
              <th className="px-3 py-2">状態</th>
              <th className="px-3 py-2">操作 / MF仕訳</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(d => {
              const st = statusOf(d)
              return (
                <tr key={d.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-3 py-2 whitespace-nowrap">{d.business_date}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{d.store_name}</td>
                  <td className="px-3 py-2">{d.department_code}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{yen(d.total_debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.checkout_count ?? '-'}</td>
                  <td className="px-3 py-2"><Badge status={st} d={d} /></td>
                  <td className="px-3 py-2">
                    {st === 'sendable' && (
                      <button
                        onClick={() => setPreview(d)}
                        className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                      >
                        確認して送信
                      </button>
                    )}
                    {st === 'sent' && (
                      <span className="text-xs text-slate-400 break-all" title={d.mf_journal_id ?? ''}>
                        MF: {(d.mf_journal_id ?? '').slice(0, 10)}…
                      </span>
                    )}
                    {st === 'review' && <span className="text-xs text-slate-400">4-2で対応</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* プレビューモーダル */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !isPending && setPreview(null)}>
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-1">送信前プレビュー</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
              {preview.business_date}　{preview.store_name}（部門{preview.department_code}）　摘要: ユビレジ売上 {deptNames[preview.department_code] ?? preview.department_code} {preview.business_date}
            </p>
            {(['debit', 'credit'] as const).map(side => (
              <div key={side} className="mb-3">
                <div className="text-sm font-semibold mb-1">{side === 'debit' ? '借方（現金/売掛金・税込）' : '貸方（売上高・税抜）'}</div>
                <table className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded">
                  <tbody>
                    {(linesByDraft.get(preview.id) ?? []).filter(l => l.side === side).map((l, i) => (
                      <tr key={i} className="border-t first:border-t-0 border-slate-200 dark:border-slate-700">
                        <td className="px-2 py-1.5">{l.account_name}{l.sub_account_name ? ` / ${l.sub_account_name}` : ''}</td>
                        <td className="px-2 py-1.5 text-xs text-slate-500">{l.trade_partner_name ?? ''}</td>
                        <td className="px-2 py-1.5 text-xs text-slate-500">{l.tax_rate != null ? `${Math.round(Number(l.tax_rate) * 100)}%` : ''}{l.memo ? ` ${l.memo}` : ''}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{yen(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="rounded bg-slate-50 dark:bg-slate-800 p-3 text-sm mb-4">
              借方合計（税込） {yen(preview.total_debit)} ＝ 貸方合計（税抜） {yen(preview.total_credit)} ＋ 消費税 {yen(preview.consumption_tax_amount)}
              {preview.total_debit === preview.total_credit + preview.consumption_tax_amount
                ? <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-semibold">✓ 貸借一致</span>
                : <span className="ml-2 text-red-600 font-semibold">✗ 不一致（送信しないでください）</span>}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPreview(null)} disabled={isPending} className="px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-sm">キャンセル</button>
              <button
                onClick={() => doSend(preview)}
                disabled={isPending || preview.total_debit !== preview.total_credit + preview.consumption_tax_amount}
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold"
              >
                {isPending ? '送信中…' : 'MFへ送信'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
