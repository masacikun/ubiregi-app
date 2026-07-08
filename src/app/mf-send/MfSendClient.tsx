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
// 税込（真の売上税込）＝ 貸方売上(税抜) + 消費税。要確認日でも欠けない値（total_debitは複数決済分が未割当のため使わない）
const inclOf = (d: DraftRow) => d.total_credit + d.consumption_tax_amount

type StatusKey = 'sent' | 'sendable' | 'review'
function statusOf(d: DraftRow): StatusKey {
  if (d.send_status === 'sent') return 'sent'
  if (d.review_required) return 'review'
  return 'sendable'
}

const BADGE = {
  sent: { label: '送信済', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300' },
  sendable: { label: '送信可', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300' },
  review: { label: '要確認', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300' },
} as const

const DOW = ['日', '月', '火', '水', '木', '金', '土']

function monthDays(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const last = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = Array(first.getDay()).fill(null)
  for (let d = 1; d <= last; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function todayStr(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

export default function MfSendClient({ drafts, lines, deptNames }: { drafts: DraftRow[]; lines: DraftLine[]; deptNames: Record<string, string> }) {
  const router = useRouter()
  const months = useMemo(() => [...new Set(drafts.map(d => d.business_date.slice(0, 7)))].sort(), [drafts])
  const [month, setMonth] = useState(months[months.length - 1] ?? todayStr().slice(0, 7))
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

  // 店（account_id昇順＝中洲→西新）と、店ごとのデータ開始日（それ以前は対象外表示）
  const storeList = useMemo(() => {
    const m = new Map<number, { name: string; minDate: string }>()
    for (const d of drafts) {
      const cur = m.get(d.account_id)
      if (!cur) m.set(d.account_id, { name: d.store_name, minDate: d.business_date })
      else if (d.business_date < cur.minDate) cur.minDate = d.business_date
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [drafts])

  const byStoreDate = useMemo(() => {
    const m = new Map<string, DraftRow>()
    for (const d of drafts) m.set(`${d.account_id}|${d.business_date}`, d)
    return m
  }, [drafts])

  function doSend(d: DraftRow) {
    startTransition(async () => {
      const res = await sendDraftAction(d.id)
      setToast(res)
      setPreview(null)
      if (res.ok) router.refresh()
      setTimeout(() => setToast(null), 6000)
    })
  }

  const today = todayStr()

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-bold">MF送信（ユビレジ売上 日次仕訳）</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">◀ 前月</button>
          <div className="font-bold tabular-nums">{month.replace('-', '年')}月</div>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">翌月 ▶</button>
        </div>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        セルの金額は<b>税込</b>売上。日をタップで仕訳プレビュー（借方=現金/売掛金・税込／貸方=売上高・税抜）。送信できるのはクリーンな日のみ。
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {storeList.map(([accountId, info]) => {
          const monthDrafts = drafts.filter(d => d.account_id === accountId && d.business_date.startsWith(month))
          const sum = {
            ex: monthDrafts.reduce((s, d) => s + d.total_credit, 0),
            tax: monthDrafts.reduce((s, d) => s + d.consumption_tax_amount, 0),
            cnt: monthDrafts.reduce((s, d) => s + (d.checkout_count ?? 0), 0),
            sent: monthDrafts.filter(d => statusOf(d) === 'sent').length,
            sendable: monthDrafts.filter(d => statusOf(d) === 'sendable').length,
            review: monthDrafts.filter(d => statusOf(d) === 'review').length,
          }
          return (
            <div key={accountId} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <h2 className="font-bold mb-2">{info.name} <span className="text-xs font-normal text-slate-400">（部門{monthDrafts[0]?.department_code ?? (accountId === 19023 ? '201' : '202')}）</span></h2>

              {/* 照合ヘッダ */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-sm">
                <div className="rounded bg-slate-50 dark:bg-slate-800 p-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">売上（税抜）</div>
                  <div className="font-bold tabular-nums">{yen(sum.ex)}</div>
                </div>
                <div className="rounded bg-slate-50 dark:bg-slate-800 p-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">消費税</div>
                  <div className="font-bold tabular-nums">{yen(sum.tax)}</div>
                </div>
                <div className="rounded bg-slate-50 dark:bg-slate-800 p-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">売上（税込）</div>
                  <div className="font-bold tabular-nums">{yen(sum.ex + sum.tax)}</div>
                </div>
                <div className="rounded bg-slate-50 dark:bg-slate-800 p-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">会計数</div>
                  <div className="font-bold tabular-nums">{sum.cnt}件</div>
                </div>
              </div>
              <div className="flex gap-3 mb-3 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">送信済み {sum.sent}日</span>
                <span className="text-blue-600 dark:text-blue-400 font-semibold">未送信 {sum.sendable}日</span>
                <span className="text-amber-600 dark:text-amber-400 font-semibold">要確認 {sum.review}日</span>
              </div>

              {/* カレンダー */}
              <div className="grid grid-cols-7 text-center text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                {DOW.map((w, i) => <div key={w} className={i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : ''}>{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthDays(month).map((date, i) => {
                  if (!date) return <div key={i} />
                  const d = byStoreDate.get(`${accountId}|${date}`)
                  const dayNum = Number(date.slice(8))
                  const isFuture = date > today
                  const beforeData = date < info.minDate
                  if (!d) {
                    return (
                      <div key={i} className="min-h-[64px] rounded border border-slate-100 dark:border-slate-800 p-1 text-left">
                        <div className="text-[11px] text-slate-400">{dayNum}</div>
                        {!isFuture && !beforeData && date >= '2026-06-01' && (
                          <div className="text-[10px] text-slate-400 mt-1">売上なし</div>
                        )}
                      </div>
                    )
                  }
                  const st = statusOf(d)
                  return (
                    <button
                      key={i}
                      onClick={() => setPreview(d)}
                      className={`min-h-[64px] rounded border p-1 text-left transition-colors hover:ring-2 hover:ring-blue-400 ${
                        st === 'sent' ? 'border-emerald-200 dark:border-emerald-800'
                        : st === 'sendable' ? 'border-blue-300 dark:border-blue-700'
                        : 'border-amber-300 dark:border-amber-700'
                      }`}
                      title={st === 'review' ? `要確認: ${d.review_reasons.join(' / ')}` : undefined}
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{dayNum}</div>
                      <div className="text-[11px] font-bold tabular-nums leading-tight">{yen(inclOf(d))}</div>
                      <span className={`inline-block mt-0.5 px-1 py-0.5 rounded text-[9px] font-semibold ${BADGE[st].cls}`}>{BADGE[st].label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* プレビューモーダル（4-1と同一内容・要確認日は送信不可） */}
      {preview && (() => {
        const st = statusOf(preview)
        const balanced = preview.total_debit === preview.total_credit + preview.consumption_tax_amount
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !isPending && setPreview(null)}>
            <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-bold text-lg">仕訳プレビュー</h2>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${BADGE[st].cls}`}>{BADGE[st].label}</span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                {preview.business_date}　{preview.store_name}（部門{preview.department_code}）　摘要: ユビレジ売上 {deptNames[preview.department_code] ?? preview.department_code} {preview.business_date}
              </p>
              {st === 'review' && (
                <div className="mb-3 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                  要確認: {preview.review_reasons.join(' / ')}（送信は4-2-2で対応予定）
                </div>
              )}
              {st === 'sent' && (
                <div className="mb-3 rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300 break-all">
                  送信済み　MF仕訳ID: {preview.mf_journal_id}
                </div>
              )}
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
                {balanced
                  ? <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-semibold">✓ 貸借一致</span>
                  : <span className="ml-2 text-amber-600 dark:text-amber-400 font-semibold">△ 複数決済等の未割当あり（要確認）</span>}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPreview(null)} disabled={isPending} className="px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-sm">閉じる</button>
                {st === 'sendable' && (
                  <button
                    onClick={() => doSend(preview)}
                    disabled={isPending || !balanced}
                    className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold"
                  >
                    {isPending ? '送信中…' : 'MFへ送信'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* トースト */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
