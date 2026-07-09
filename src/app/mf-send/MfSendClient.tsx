'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendDraftAction, resolveCheckoutAction, applySalesReclassAction, unresolveCheckoutAction, resetDraftAction, verifyJournalsAction, type Allocation } from './actions'

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
export type ReviewItem = {
  id: number
  draft_id: number
  checkout_id: number | null
  reason: string
  detail: { total?: number; payments?: { name: string; amount: number }[]; flag_reason?: string; subtotal?: number; checkout_total?: number; applied?: Allocation[] } | null
  resolved: boolean
}
export type PaymentMapRow = {
  account_id: number | null
  payment_type_name: string
  credit_account_name: string
  credit_sub_account_name: string | null
  trade_partner_name: string | null
  is_deposit_amount: boolean
}
export type OverrideRow = {
  id: number
  draft_id: number
  kind: string
  original: { sub?: string; amount_incl?: number }
  replacement: { sub: string; amount_incl: number }[]
  reason: string
  created_at: string
}

export type VerifyResult = { draft_id: number; business_date: string; account_id: number; status: 'ok' | 'mismatch' | 'missing' | 'stale'; diffs: string[] }
export type VerifyRun = {
  ran_at: string
  summary: { checked: number; ok: number; mismatch: number; missing: number; stale?: number }
  results: VerifyResult[]
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
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
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// ---- 複数決済の確定フォーム ----
type TargetOpt = { key: string; label: string; account: string; sub: string | null; partner: string | null; isDeposit: boolean }

function ResolveCheckoutCard({ item, paymentMap, accountId, onDone }: {
  item: ReviewItem
  paymentMap: PaymentMapRow[]
  accountId: number
  onDone: (r: { ok: boolean; message: string }) => void
}) {
  const total = Math.round(Number(item.detail?.total ?? 0))
  const payments = item.detail?.payments ?? []

  const targets: TargetOpt[] = useMemo(() => {
    const seen = new Map<string, TargetOpt>()
    for (const p of paymentMap) {
      const key = `${p.credit_account_name}|${p.credit_sub_account_name ?? ''}|${p.trade_partner_name ?? ''}`
      if (!seen.has(key)) seen.set(key, {
        key,
        label: `${p.credit_account_name}${p.credit_sub_account_name ? `/${p.credit_sub_account_name}` : ''}${p.trade_partner_name ? `（${p.trade_partner_name}）` : ''}`,
        account: p.credit_account_name, sub: p.credit_sub_account_name, partner: p.trade_partner_name, isDeposit: p.is_deposit_amount,
      })
    }
    return [...seen.values()]
  }, [paymentMap])

  const lookup = (name: string): PaymentMapRow | undefined =>
    paymentMap.find(p => p.account_id === accountId && p.payment_type_name === name) ??
    paymentMap.find(p => p.account_id === null && p.payment_type_name === name)

  // 初期提案：現金(預かり金)は total−他決済 で逆算・非現金はamountそのまま。現金は1行に集約
  const initialRows = useMemo(() => {
    const nonCash: { name: string; amount: number; opt: TargetOpt | null }[] = []
    let hasCash = false
    let cashOpt: TargetOpt | null = null
    for (const p of payments) {
      const pm = lookup(p.name)
      const opt = pm ? targets.find(t => t.account === pm.credit_account_name && t.sub === (pm.credit_sub_account_name ?? null) && t.partner === (pm.trade_partner_name ?? null)) ?? null : null
      if (pm?.is_deposit_amount) { hasCash = true; cashOpt = opt } else nonCash.push({ name: p.name, amount: Math.round(p.amount), opt })
    }
    const rows = nonCash.map(r => ({ label: r.name, targetKey: r.opt?.key ?? '', amount: r.amount, isCash: false, unknown: !r.opt }))
    if (hasCash) {
      const cashAmt = total - nonCash.reduce((s, r) => s + r.amount, 0)
      rows.push({ label: '現金（total−他決済で逆算）', targetKey: cashOpt?.key ?? '', amount: cashAmt, isCash: true, unknown: !cashOpt })
    }
    return rows
  }, [payments, targets, total, accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  const [rows, setRows] = useState(initialRows)
  const [busy, setBusy] = useState(false)
  const sum = rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0)
  const hasNegative = rows.some(r => r.amount < 0)
  const hasUnknown = rows.some(r => !r.targetKey)
  const ok = sum === total && !hasNegative && !hasUnknown

  async function confirm() {
    setBusy(true)
    const allocations: Allocation[] = rows.map(r => {
      const t = targets.find(x => x.key === r.targetKey)!
      return { account: t.account, sub: t.sub, partner: t.partner, amountIncl: r.amount }
    })
    const res = await resolveCheckoutAction(item.id, allocations)
    setBusy(false)
    onDone(res)
  }

  const inp = 'w-28 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-right text-sm tabular-nums'
  const sel = 'rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1 py-1 text-xs max-w-[220px]'

  return (
    <div className="rounded border border-amber-300 dark:border-amber-700 p-3 mb-2">
      <div className="text-sm font-semibold mb-1">複数決済の会計（会計ID: {item.checkout_id}・合計 {yen(total)}）</div>
      <table className="w-full text-sm mb-2">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t first:border-t-0 border-slate-200 dark:border-slate-700">
              <td className="py-1 pr-2 text-xs">{r.label}{r.isCash && <span className="ml-1 text-slate-400">※預かり金は使わず逆算</span>}</td>
              <td className="py-1 pr-2">
                <select className={sel} value={r.targetKey}
                  onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, targetKey: e.target.value } : x))}>
                  <option value="">（借方先を選択）</option>
                  {targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </td>
              <td className="py-1 text-right">
                <input type="number" className={inp} value={r.amount}
                  onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, amount: Math.round(Number(e.target.value)) } : x))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between">
        <div className={`text-xs ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          配分合計 {yen(sum)} / 会計合計 {yen(total)}
          {hasNegative && '（マイナスは確定不可＝打ち間違いの可能性）'}
          {hasUnknown && '（未選択の借方先があります）'}
        </div>
        <button onClick={confirm} disabled={!ok || busy}
          className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold">
          {busy ? '確定中…' : 'この会計を確定'}
        </button>
      </div>
    </div>
  )
}

// ---- 複数決済の確定済みカード（送信前なら取り消し可能） ----
function ResolvedCheckoutCard({ item, onDone }: { item: ReviewItem; onDone: (r: { ok: boolean; message: string }) => void }) {
  const [busy, setBusy] = useState(false)
  const applied = item.detail?.applied ?? []
  async function undo() {
    if (!window.confirm(`会計ID ${item.checkout_id} の確定を取り消して「要確認」に戻します。よろしいですか？`)) return
    setBusy(true)
    const res = await unresolveCheckoutAction(item.id)
    setBusy(false)
    onDone(res)
  }
  return (
    <div className="rounded border border-emerald-300 dark:border-emerald-700 p-3 mb-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs">
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">確定済み</span>
          　複数決済（会計ID: {item.checkout_id}・合計 {yen(Math.round(Number(item.detail?.total ?? 0)))}）
          {applied.length > 0 && (
            <span className="text-slate-500 dark:text-slate-400"> → {applied.map(a => `${a.account}${a.sub ? `/${a.sub}` : ''} ${yen(a.amountIncl)}`).join(' ＋ ')}</span>
          )}
        </div>
        <button onClick={undo} disabled={busy}
          className="shrink-0 px-2 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50">
          {busy ? '取消中…' : '確定を取り消す'}
        </button>
      </div>
    </div>
  )
}

// ---- 7/2型 売上補正フォーム（イレギュラー専用） ----
function ReclassForm({ draft, onDone }: { draft: DraftRow; onDone: (r: { ok: boolean; message: string }) => void }) {
  const [fromIncl, setFromIncl] = useState(140000)
  const [allocs, setAllocs] = useState([{ sub: 'フード', amountIncl: 105000 }, { sub: 'ドリンク', amountIncl: 35000 }])
  const [reason, setReason] = useState('2026-07-02 宴会35名の「その他料金」一括打ちの補正：実態はフード¥3,000＋ドリンク¥1,000（税込）×35名（仕訳ルール集・個別案件参照）')
  const [busy, setBusy] = useState(false)
  const sum = allocs.reduce((s, a) => s + a.amountIncl, 0)
  const ok = sum === fromIncl && reason.trim().length > 0 && allocs.every(a => a.amountIncl > 0)

  async function apply() {
    setBusy(true)
    const res = await applySalesReclassAction(draft.id, 'その他', fromIncl, allocs, reason)
    setBusy(false)
    onDone(res)
  }
  const inp = 'w-28 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-right text-sm tabular-nums'

  return (
    <div className="rounded border border-purple-300 dark:border-purple-700 p-3 mb-3">
      <div className="text-sm font-semibold mb-1 text-purple-700 dark:text-purple-300">イレギュラー補正（売上の科目内振替・原本は変更しません）</div>
      <div className="text-xs mb-2 flex items-center gap-2">
        元: 売上高/その他（税込）
        <input type="number" className={inp} value={fromIncl} onChange={e => setFromIncl(Math.round(Number(e.target.value)))} />
        → 振替先:
      </div>
      {allocs.map((a, i) => (
        <div key={i} className="flex items-center gap-2 mb-1 text-xs">
          <select className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1"
            value={a.sub} onChange={e => setAllocs(xs => xs.map((x, j) => j === i ? { ...x, sub: e.target.value } : x))}>
            {['フード', 'ドリンク', 'その他'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="number" className={inp} value={a.amountIncl}
            onChange={e => setAllocs(xs => xs.map((x, j) => j === i ? { ...x, amountIncl: Math.round(Number(e.target.value)) } : x))} />
          <span className="text-slate-400">税込</span>
        </div>
      ))}
      <textarea className="w-full mt-1 mb-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs" rows={2}
        placeholder="補正理由（必須）" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="flex items-center justify-between">
        <div className={`text-xs ${sum === fromIncl ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          振替先合計 {yen(sum)} / 元 {yen(fromIncl)}（税10%固定・税額と貸借は不変）
        </div>
        <button onClick={apply} disabled={!ok || busy}
          className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-semibold">
          {busy ? '適用中…' : '補正を適用'}
        </button>
      </div>
    </div>
  )
}

export default function MfSendClient({ drafts, lines, deptNames, reviewItems, paymentMap, overrides, verifyRun }: {
  drafts: DraftRow[]; lines: DraftLine[]; deptNames: Record<string, string>
  reviewItems: ReviewItem[]; paymentMap: PaymentMapRow[]; overrides: OverrideRow[]
  verifyRun: VerifyRun | null
}) {
  const router = useRouter()
  const months = useMemo(() => [...new Set(drafts.map(d => d.business_date.slice(0, 7)))].sort(), [drafts])
  const [month, setMonth] = useState(months[months.length - 1] ?? todayStr().slice(0, 7))
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  const preview = useMemo(() => drafts.find(d => d.id === previewId) ?? null, [drafts, previewId])

  const linesByDraft = useMemo(() => {
    const m = new Map<number, DraftLine[]>()
    for (const l of lines) {
      if (!m.has(l.draft_id)) m.set(l.draft_id, [])
      m.get(l.draft_id)!.push(l)
    }
    return m
  }, [lines])
  const itemsByDraft = useMemo(() => {
    const m = new Map<number, ReviewItem[]>()
    for (const r of reviewItems) {
      if (!m.has(r.draft_id)) m.set(r.draft_id, [])
      m.get(r.draft_id)!.push(r)
    }
    return m
  }, [reviewItems])
  const overridesByDraft = useMemo(() => {
    const m = new Map<number, OverrideRow[]>()
    for (const o of overrides) {
      if (!m.has(o.draft_id)) m.set(o.draft_id, [])
      m.get(o.draft_id)!.push(o)
    }
    return m
  }, [overrides])

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

  function notify(res: { ok: boolean; message: string }) {
    setToast(res)
    if (res.ok) router.refresh()
    setTimeout(() => setToast(null), 7000)
  }
  function doSend(d: DraftRow) {
    startTransition(async () => {
      const res = await sendDraftAction(d.id)
      setPreviewId(null)
      notify(res)
    })
  }
  const verifyByDraft = useMemo(() => {
    const m = new Map<number, VerifyResult>()
    for (const r of verifyRun?.results ?? []) m.set(r.draft_id, r)
    return m
  }, [verifyRun])
  const verifyBad = (verifyRun?.summary.mismatch ?? 0) + (verifyRun?.summary.missing ?? 0) + (verifyRun?.summary.stale ?? 0)

  function doVerify() {
    startTransition(async () => {
      const res = await verifyJournalsAction()
      notify(res)
    })
  }
  function doReset(d: DraftRow) {
    if (!window.confirm(`${d.business_date} ${d.store_name} の仕訳ドラフトを初期状態に再生成します。\nこの日の手動確定・補正はすべてやり直しになります（送信済みの日は対象外）。よろしいですか？`)) return
    startTransition(async () => {
      const res = await resetDraftAction(d.id)
      setPreviewId(null)
      notify(res)
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
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
        セルの金額は<b>税込</b>売上。日をタップで仕訳プレビュー。要確認の日はプレビュー内で複数決済の確定・補正ができます。
      </p>

      {/* MF突合（乖離検知）: 送信済み仕訳がMF側で変更/削除されていないか＋送信後の後着会計 */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <button onClick={doVerify} disabled={isPending}
          className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
          {isPending ? '突合中…' : '⚖ MFと突合'}
        </button>
        {verifyRun ? (
          <span className={verifyBad > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}>
            最終突合 {new Date(verifyRun.ran_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}：
            {verifyBad === 0
              ? `全${verifyRun.summary.checked}件一致`
              : `⚠️ 乖離 ${verifyBad}件（MF修正 ${verifyRun.summary.mismatch}・MF不在 ${verifyRun.summary.missing}・後着データ ${verifyRun.summary.stale ?? 0}）`}
          </span>
        ) : (
          <span className="text-slate-400">未実行（「MFと突合」で送信済み仕訳とMF実物のズレを検査）</span>
        )}
      </div>

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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-sm">
                {[['売上（税抜）', yen(sum.ex)], ['消費税', yen(sum.tax)], ['売上（税込）', yen(sum.ex + sum.tax)], ['会計数', `${sum.cnt}件`]].map(([k, v]) => (
                  <div key={k} className="rounded bg-slate-50 dark:bg-slate-800 p-2">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{k}</div>
                    <div className="font-bold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mb-3 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">送信済み {sum.sent}日</span>
                <span className="text-blue-600 dark:text-blue-400 font-semibold">未送信 {sum.sendable}日</span>
                <span className="text-amber-600 dark:text-amber-400 font-semibold">要確認 {sum.review}日</span>
              </div>
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
                  const hasOverride = (overridesByDraft.get(d.id)?.length ?? 0) > 0
                  const vr = verifyByDraft.get(d.id)
                  const vWarn = vr != null && vr.status !== 'ok'
                  return (
                    <button
                      key={i}
                      onClick={() => setPreviewId(d.id)}
                      className={`min-h-[64px] rounded border p-1 text-left transition-colors hover:ring-2 hover:ring-blue-400 ${
                        st === 'sent' ? 'border-emerald-200 dark:border-emerald-800'
                        : st === 'sendable' ? 'border-blue-300 dark:border-blue-700'
                        : 'border-amber-300 dark:border-amber-700'
                      } ${vWarn ? 'ring-2 ring-red-500' : ''}`}
                      title={vWarn ? `MF乖離: ${vr!.diffs.join(' / ')}` : st === 'review' ? `要確認: ${d.review_reasons.join(' / ')}` : undefined}
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{dayNum}{hasOverride && <span className="ml-1 text-purple-500">補</span>}</div>
                      <div className="text-[11px] font-bold tabular-nums leading-tight">{yen(inclOf(d))}</div>
                      <span className={`inline-block mt-0.5 px-1 py-0.5 rounded text-[9px] font-semibold ${BADGE[st].cls}`}>{BADGE[st].label}</span>
                      {vWarn && <span className="inline-block mt-0.5 ml-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-red-600 text-white">⚠MF</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* プレビューモーダル */}
      {preview && (() => {
        const st = statusOf(preview)
        const balanced = preview.total_debit === preview.total_credit + preview.consumption_tax_amount
        const items = itemsByDraft.get(preview.id) ?? []
        const unresolvedMulti = items.filter(r => r.reason === '複数決済' && !r.resolved)
        const resolvedMulti = items.filter(r => r.reason === '複数決済' && r.resolved)
        const needsReclass = preview.review_reasons.some(r => r.startsWith('要確認商品')) && items.some(r => r.reason.startsWith('要確認商品') && !r.resolved)
        const ovs = overridesByDraft.get(preview.id) ?? []
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !isPending && setPreviewId(null)}>
            <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-bold text-lg">仕訳プレビュー</h2>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${BADGE[st].cls}`}>{BADGE[st].label}</span>
                {ovs.length > 0 && <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300">補正あり</span>}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                {preview.business_date}　{preview.store_name}（部門{preview.department_code}）　摘要: ユビレジ売上 {deptNames[preview.department_code] ?? preview.department_code} {preview.business_date}
              </p>

              {st === 'sent' && (
                <div className="mb-3 rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300 break-all">
                  送信済み　MF仕訳ID: {preview.mf_journal_id}
                </div>
              )}

              {/* 乖離検知の結果（MF側の修正/削除・送信後の後着データ） */}
              {(() => {
                const vr = verifyByDraft.get(preview.id)
                if (!vr || vr.status === 'ok') return null
                const label = vr.status === 'missing' ? 'MFに仕訳が見つかりません' : vr.status === 'stale' ? '送信後にユビレジ会計が変化しています' : 'MF側で修正された可能性があります'
                return (
                  <div className="mb-3 rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs">
                    <div className="font-semibold text-red-700 dark:text-red-300 mb-1">⚠️ MFとの乖離を検知：{label}</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-red-800 dark:text-red-200">
                      {vr.diffs.map((df, i) => <li key={i}>{df}</li>)}
                    </ul>
                    <div className="mt-1.5 text-slate-600 dark:text-slate-400">
                      対処の原則：MFで直接直さず<b>番頭さんから</b>（MF仕訳の削除→ドラフト戻し→再確定→再送。Claudeに依頼可）。MF側の修正が正しい場合はその旨を記録に残してください。
                    </div>
                  </div>
                )
              })()}

              {/* 要確認：複数決済の確定 */}
              {unresolvedMulti.map(item => (
                <ResolveCheckoutCard key={item.id} item={item} paymentMap={paymentMap} accountId={preview.account_id} onDone={notify} />
              ))}

              {/* 確定済みの複数決済（送信前なら取り消せる） */}
              {st !== 'sent' && resolvedMulti.map(item => (
                <ResolvedCheckoutCard key={item.id} item={item} onDone={notify} />
              ))}

              {/* 要確認：7/2型の補正 */}
              {needsReclass && <ReclassForm draft={preview} onDone={notify} />}

              {/* 補正履歴（監査表示） */}
              {ovs.map(o => (
                <div key={o.id} className="mb-3 rounded border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 px-3 py-2 text-xs">
                  <div className="font-semibold text-purple-700 dark:text-purple-300">補正記録 #{o.id}</div>
                  <div>元: 売上高/{o.original.sub} 税込{yen(o.original.amount_incl ?? 0)} → {o.replacement.map(r => `${r.sub} 税込${yen(r.amount_incl)}`).join(' ＋ ')}</div>
                  <div className="text-slate-500 dark:text-slate-400">理由: {o.reason}</div>
                </div>
              ))}

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
                  : <span className="ml-2 text-amber-600 dark:text-amber-400 font-semibold">△ 差額 {yen(preview.total_credit + preview.consumption_tax_amount - preview.total_debit)}（複数決済の未確定）</span>}
              </div>
              <div className="flex justify-end gap-2">
                {st !== 'sent' && (
                  <button onClick={() => doReset(preview)} disabled={isPending}
                    title="この日の仕訳ドラフトを生成し直します（手動確定・補正はやり直しになります）"
                    className="mr-auto px-4 py-2 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50">
                    この日をリセット（再生成）
                  </button>
                )}
                <button onClick={() => setPreviewId(null)} disabled={isPending} className="px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-sm">閉じる</button>
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

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
