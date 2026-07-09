'use server'

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { supabaseAdmin } from '@/lib/supabase-admin'

const execFileAsync = promisify(execFile)

// 送信ロジックは 3-A で確定・実弾検証済みの CLI（mf-accounting-sync/scripts/ubiregi_journal_send.mjs）を
// そのまま呼ぶ（重複実装しない）。向き・部門・取引先・税・memoなし・remarkガード・二重送信ロックすべてCLI側で担保。
const MF_APP_DIR = process.env.MF_SEND_APP_DIR ?? '/var/www/mf-accounting-sync'
const HYD_START = '2026-06-01'

export type SendResult = { ok: boolean; message: string }

export async function sendDraftAction(draftId: number): Promise<SendResult> {
  if (!Number.isInteger(draftId) || draftId <= 0) return { ok: false, message: '不正なdraft_id' }

  // UI側の事前バリデーション（最終ガードはCLI側の条件付きUPDATEロック）
  const { data: draft, error } = await supabaseAdmin
    .from('ubiregi_journal_drafts')
    .select('id, business_date, review_required, send_status, mf_journal_id')
    .eq('id', draftId)
    .single()
  if (error || !draft) return { ok: false, message: `ドラフトが見つかりません: ${error?.message ?? draftId}` }
  if (draft.review_required) return { ok: false, message: '要確認の日は未確定です（複数決済の確定/補正を先に）' }
  if (draft.business_date < HYD_START) return { ok: false, message: '2026-06-01より前は送信対象外です' }
  if (draft.send_status === 'sent') return { ok: false, message: '送信済みです（再送不可）' }

  try {
    const { stdout } = await execFileAsync(
      'node',
      ['scripts/ubiregi_journal_send.mjs', 'test', '--draft-id', String(draftId)],
      { cwd: MF_APP_DIR, timeout: 90_000 },
    )
    if (stdout.includes('[既存検出]')) return { ok: true, message: 'MFに既存の仕訳を検出し、送信済みとして紐づけました（二重送信なし）' }
    const m = stdout.match(/\[sent\].*No\.(\S+)\)/)
    if (stdout.includes('[sent]')) return { ok: true, message: `MFへ送信しました${m ? `（仕訳No.${m[1]}）` : ''}` }
    if (stdout.includes('[skip]')) return { ok: false, message: '送信ロックを取得できませんでした（送信済み/送信中）' }
    return { ok: false, message: `想定外の結果: ${stdout.slice(-300)}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `送信エラー: ${msg.slice(0, 300)}（send_status=errorで再送可能）` }
  }
}

// ---- 4-2-2: 要確認日の確定処理（すべてドラフト側・ユビレジ原本非破壊） ----

export type Allocation = {
  account: string           // 借方科目（現金/売掛金）
  sub: string | null        // 補助
  partner: string | null    // 取引先（売掛系のみ）
  amountIncl: number        // 税込
}

// 日次ドラフトの合計・要確認フラグを再計算（未解決itemsゼロ＋貸借一致で送信可へ）
async function recomputeDraft(draftId: number): Promise<{ balanced: boolean; unresolved: number }> {
  const [{ data: lines }, { data: items }, { data: draft }] = await Promise.all([
    supabaseAdmin.from('ubiregi_journal_draft_lines').select('side, amount').eq('draft_id', draftId),
    supabaseAdmin.from('ubiregi_journal_review_items').select('id, resolved').eq('draft_id', draftId),
    supabaseAdmin.from('ubiregi_journal_drafts').select('consumption_tax_amount, review_reasons').eq('id', draftId).single(),
  ])
  const totalDebit = (lines ?? []).filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
  const totalCredit = (lines ?? []).filter(l => l.side === 'credit').reduce((s, l) => s + l.amount, 0)
  const unresolved = (items ?? []).filter(i => !i.resolved).length
  const balanced = totalDebit === totalCredit + (draft?.consumption_tax_amount ?? 0)
  const reviewRequired = !(unresolved === 0 && balanced)
  await supabaseAdmin.from('ubiregi_journal_drafts')
    .update({ total_debit: totalDebit, total_credit: totalCredit, review_required: reviewRequired })
    .eq('id', draftId).neq('send_status', 'sent')
  return { balanced, unresolved }
}

// A. 複数決済会計の確定：借方行（現金/売掛金・税込）を追加し review_item を解決
export async function resolveCheckoutAction(reviewItemId: number, allocations: Allocation[]): Promise<SendResult> {
  const { data: item, error } = await supabaseAdmin
    .from('ubiregi_journal_review_items')
    .select('id, draft_id, checkout_id, reason, detail, resolved')
    .eq('id', reviewItemId).single()
  if (error || !item) return { ok: false, message: `対象が見つかりません: ${error?.message ?? reviewItemId}` }
  if (item.resolved) return { ok: false, message: 'この会計は確定済みです' }
  if (item.reason !== '複数決済') return { ok: false, message: 'この項目は複数決済ではありません' }

  const { data: draft } = await supabaseAdmin.from('ubiregi_journal_drafts')
    .select('id, send_status').eq('id', item.draft_id).single()
  if (!draft || draft.send_status === 'sent') return { ok: false, message: '送信済みの日は変更できません' }

  // 金額の正はDBのcheckouts.total（detailのtotalと二重確認）
  const { data: co } = await supabaseAdmin.from('ubiregi_checkouts')
    .select('total, status').eq('id', item.checkout_id).single()
  const trueTotal = Math.round(Number(co?.total ?? 0))
  const detailTotal = Math.round(Number((item.detail as { total?: number })?.total ?? 0))
  if (!co || co.status !== 'closed' || trueTotal !== detailTotal)
    return { ok: false, message: `会計金額の整合が取れません（DB=${trueTotal} / 退避時=${detailTotal}）` }

  if (!Array.isArray(allocations) || allocations.length === 0) return { ok: false, message: '配分がありません' }
  for (const a of allocations) {
    if (!a.account || !Number.isInteger(a.amountIncl)) return { ok: false, message: '配分の形式が不正です' }
    if (a.amountIncl < 0) return { ok: false, message: `マイナス配分は確定できません（${a.account}/${a.sub ?? '-'}: ${a.amountIncl}）。打ち間違いの可能性があるため要確認のまま残してください` }
  }
  const sum = allocations.reduce((s, a) => s + a.amountIncl, 0)
  if (sum !== trueTotal) return { ok: false, message: `配分合計¥${sum.toLocaleString()}が会計合計¥${trueTotal.toLocaleString()}と一致しません` }

  // 借方行を追加（同一キー＝side+科目+補助+取引先+税率(null) の既存行があれば合算・無ければ追加。金額0はスキップ）
  const { data: maxRow } = await supabaseAdmin.from('ubiregi_journal_draft_lines')
    .select('sort_order').eq('draft_id', item.draft_id).order('sort_order', { ascending: false }).limit(1)
  let sort = (maxRow?.[0]?.sort_order ?? 0) + 1
  for (const a of allocations.filter(x => x.amountIncl > 0)) {
    let q = supabaseAdmin.from('ubiregi_journal_draft_lines')
      .select('id, amount, memo')
      .eq('draft_id', item.draft_id).eq('side', 'debit').eq('account_name', a.account)
      .is('tax_rate', null)
    q = a.sub === null ? q.is('sub_account_name', null) : q.eq('sub_account_name', a.sub)
    q = a.partner === null ? q.is('trade_partner_name', null) : q.eq('trade_partner_name', a.partner)
    const { data: hit } = await q.limit(1)
    const tag = `複数決済確定 co=${item.checkout_id}`
    if (hit?.[0]) {
      const { error: eUp } = await supabaseAdmin.from('ubiregi_journal_draft_lines')
        .update({ amount: hit[0].amount + a.amountIncl, memo: hit[0].memo ? `${hit[0].memo} / ${tag}` : tag })
        .eq('id', hit[0].id)
      if (eUp) return { ok: false, message: `行合算に失敗: ${eUp.message}` }
    } else {
      const { error: eIns } = await supabaseAdmin.from('ubiregi_journal_draft_lines').insert({
        draft_id: item.draft_id, side: 'debit', account_name: a.account,
        sub_account_name: a.sub, trade_partner_name: a.partner, tax_rate: null,
        amount: a.amountIncl, sort_order: sort++, memo: tag,
      })
      if (eIns) return { ok: false, message: `行追加に失敗: ${eIns.message}` }
    }
  }
  // 取り消し（unresolveCheckoutAction）で正確に逆演算できるよう、適用した配分を detail に保存する
  await supabaseAdmin.from('ubiregi_journal_review_items')
    .update({ resolved: true, detail: { ...((item.detail as Record<string, unknown>) ?? {}), applied: allocations.filter(a => a.amountIncl > 0) } })
    .eq('id', reviewItemId)

  const { balanced, unresolved } = await recomputeDraft(item.draft_id)
  return {
    ok: true,
    message: unresolved === 0 && balanced
      ? '確定しました。貸借一致＝この日は送信可能になりました'
      : `確定しました（残り未確定${unresolved}件${balanced ? '' : '・貸借未一致'}）`,
  }
}

// A'. 複数決済確定の取り消し（送信前のみ）：detail.applied を使って借方行から正確に減算し、要確認に戻す
export async function unresolveCheckoutAction(reviewItemId: number): Promise<SendResult> {
  const { data: item, error } = await supabaseAdmin
    .from('ubiregi_journal_review_items')
    .select('id, draft_id, checkout_id, reason, detail, resolved')
    .eq('id', reviewItemId).single()
  if (error || !item) return { ok: false, message: `対象が見つかりません: ${error?.message ?? reviewItemId}` }
  if (!item.resolved) return { ok: false, message: 'この会計は未確定です（取り消し不要）' }
  if (item.reason !== '複数決済') return { ok: false, message: 'この項目は複数決済ではありません' }

  const { data: draft } = await supabaseAdmin.from('ubiregi_journal_drafts')
    .select('id, send_status').eq('id', item.draft_id).single()
  if (!draft || draft.send_status === 'sent') return { ok: false, message: '送信済みの日は変更できません' }

  const applied = (item.detail as { applied?: Allocation[] })?.applied
  if (!Array.isArray(applied) || applied.length === 0) {
    return { ok: false, message: 'この確定には配分の記録がありません（機能追加前の確定）。「この日をリセット（再生成）」でやり直してください' }
  }

  // 同一キーはまとめてから（確定側も同一キーは1行に合算されているため、逆演算も合算で行う）
  const byKey = new Map<string, Allocation>()
  for (const a of applied) {
    const key = `${a.account}|${a.sub ?? ''}|${a.partner ?? ''}`
    const cur = byKey.get(key)
    if (cur) cur.amountIncl += a.amountIncl
    else byKey.set(key, { ...a })
  }

  // 事前に全行の減算可否を確認してから反映（途中失敗で中途半端にしない）
  const tag = `複数決済確定 co=${item.checkout_id}`
  const plans: { id: number; newAmount: number; newMemo: string | null }[] = []
  for (const a of byKey.values()) {
    let q = supabaseAdmin.from('ubiregi_journal_draft_lines')
      .select('id, amount, memo')
      .eq('draft_id', item.draft_id).eq('side', 'debit').eq('account_name', a.account)
      .is('tax_rate', null)
    q = a.sub === null ? q.is('sub_account_name', null) : q.eq('sub_account_name', a.sub)
    q = a.partner === null ? q.is('trade_partner_name', null) : q.eq('trade_partner_name', a.partner)
    const { data: hit } = await q.limit(1)
    const line = hit?.[0]
    if (!line || line.amount < a.amountIncl) {
      return { ok: false, message: `取消対象の借方行が見つからないか金額が不足しています（${a.account}${a.sub ? `/${a.sub}` : ''}）。「この日をリセット（再生成）」でやり直してください` }
    }
    const parts = (line.memo ?? '').split(' / ').filter(Boolean)
    const idx = parts.indexOf(tag)
    if (idx >= 0) parts.splice(idx, 1)
    plans.push({ id: line.id, newAmount: line.amount - a.amountIncl, newMemo: parts.length ? parts.join(' / ') : null })
  }
  for (const p of plans) {
    if (p.newAmount === 0) {
      const { error: eDel } = await supabaseAdmin.from('ubiregi_journal_draft_lines').delete().eq('id', p.id)
      if (eDel) return { ok: false, message: `行削除に失敗: ${eDel.message}` }
    } else {
      const { error: eUp } = await supabaseAdmin.from('ubiregi_journal_draft_lines').update({ amount: p.newAmount, memo: p.newMemo }).eq('id', p.id)
      if (eUp) return { ok: false, message: `行減算に失敗: ${eUp.message}` }
    }
  }

  const detailRest = { ...((item.detail as Record<string, unknown>) ?? {}) }
  delete detailRest.applied
  await supabaseAdmin.from('ubiregi_journal_review_items')
    .update({ resolved: false, detail: detailRest }).eq('id', reviewItemId)

  await recomputeDraft(item.draft_id)
  return { ok: true, message: '確定を取り消しました（この会計は要確認に戻りました）' }
}

// D. MF突合（乖離検知・2026-07-09方針: MF×番頭さん両方から操作しうるデータは全て乖離検知）
// sent済みドラフト vs MF実仕訳（削除/修正検知）＋ vs 現在のユビレジ集計（後着データ検知）。結果は verify_runs に保存。
export async function verifyJournalsAction(): Promise<SendResult> {
  try {
    const { stdout } = await execFileAsync(
      'node', ['scripts/ubiregi_journal_verify.mjs'],
      { cwd: MF_APP_DIR, timeout: 180_000 },
    )
    const m = stdout.match(/OK (\d+) \/ 不一致 (\d+) \/ MF不在 (\d+) \/ 後着データ (\d+)/)
    if (!m) return { ok: false, message: `想定外の結果: ${stdout.slice(-300)}` }
    const bad = Number(m[2]) + Number(m[3]) + Number(m[4])
    return { ok: true, message: bad === 0 ? `MF突合完了: 全${Number(m[1])}件一致（乖離なし）` : `MF突合完了: OK${m[1]}・不一致${m[2]}・MF不在${m[3]}・後着データ${m[4]} — ⚠️バッジの日を確認してください` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `突合エラー: ${msg.slice(0, 300)}` }
  }
}

// C. 日次リセット（送信前のみ）：この店×この日のドラフトを生成スクリプトで作り直す（万能のやり直し）。
// 手動確定・補正はすべて初期状態に戻る（sent は生成スクリプト側でも保護）。他店・他日は --account/--from/--to で巻き込まない。
export async function resetDraftAction(draftId: number): Promise<SendResult> {
  const { data: draft, error } = await supabaseAdmin.from('ubiregi_journal_drafts')
    .select('id, business_date, account_id, send_status').eq('id', draftId).single()
  if (error || !draft) return { ok: false, message: `ドラフトが見つかりません: ${error?.message ?? draftId}` }
  if (draft.send_status === 'sent') return { ok: false, message: '送信済みの日はリセットできません' }
  if (draft.business_date < HYD_START) return { ok: false, message: '2026-06-01より前は対象外です' }

  try {
    const { stdout } = await execFileAsync(
      'node',
      ['scripts/generate_journal_drafts.mjs', '--from', draft.business_date, '--to', draft.business_date, '--account', String(draft.account_id)],
      { cwd: process.cwd(), timeout: 120_000 },
    )
    if (!stdout.includes('生成:')) return { ok: false, message: `想定外の結果: ${stdout.slice(-300)}` }
    return { ok: true, message: `${draft.business_date} を初期状態に再生成しました（確定・補正はやり直しできます）` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `再生成エラー: ${msg.slice(0, 300)}` }
  }
}

// B. 7/2型の売上補正（イレギュラー専用・原本非破壊・理由必須・元値はoverridesに保持）
export async function applySalesReclassAction(
  draftId: number, fromSub: string, fromAmountIncl: number,
  allocs: { sub: string; amountIncl: number }[], reason: string,
): Promise<SendResult> {
  if (!reason?.trim()) return { ok: false, message: '補正理由の入力は必須です' }
  const { data: draft } = await supabaseAdmin.from('ubiregi_journal_drafts')
    .select('id, send_status, review_required, review_reasons').eq('id', draftId).single()
  if (!draft) return { ok: false, message: 'ドラフトが見つかりません' }
  if (draft.send_status === 'sent') return { ok: false, message: '送信済みの日は補正できません' }
  const isIrregular = (draft.review_reasons ?? []).some((r: string) => r.startsWith('要確認商品'))
  if (!isIrregular) return { ok: false, message: '補正はイレギュラー日（要確認商品フラグのある日）専用です' }

  const sumIncl = allocs.reduce((s, a) => s + a.amountIncl, 0)
  if (sumIncl !== fromAmountIncl) return { ok: false, message: `振替先合計¥${sumIncl.toLocaleString()}が元金額¥${fromAmountIncl.toLocaleString()}と一致しません` }
  if (allocs.some(a => a.amountIncl <= 0 || !a.sub)) return { ok: false, message: '振替先の形式が不正です' }

  // 税抜変換（10%固定・Σ保存の端数調整＝最大行に寄せる）→ 税額・貸借を変えない
  const RATE = 0.1
  const fromEx = Math.round(fromAmountIncl / (1 + RATE))
  const exAllocs = allocs.map(a => ({ ...a, amountEx: Math.round(a.amountIncl / (1 + RATE)) }))
  const residual = fromEx - exAllocs.reduce((s, a) => s + a.amountEx, 0)
  if (residual !== 0) exAllocs.reduce((m, a) => (a.amountEx > m.amountEx ? a : m)).amountEx += residual

  // 元の貸方行（売上高/fromSub・10%）から減額
  const { data: fromLines } = await supabaseAdmin.from('ubiregi_journal_draft_lines')
    .select('id, amount').eq('draft_id', draftId).eq('side', 'credit')
    .eq('account_name', '売上高').eq('sub_account_name', fromSub).eq('tax_rate', 0.1)
  const fromLine = fromLines?.[0]
  if (!fromLine || fromLine.amount < fromEx)
    return { ok: false, message: `元の行（売上高/${fromSub}）の金額が不足しています（行=${fromLine?.amount ?? 'なし'} / 必要=${fromEx}）` }
  const remain = fromLine.amount - fromEx
  if (remain > 0) {
    await supabaseAdmin.from('ubiregi_journal_draft_lines').update({ amount: remain, memo: `補正で税抜¥${fromEx.toLocaleString()}を振替済み` }).eq('id', fromLine.id)
  } else {
    await supabaseAdmin.from('ubiregi_journal_draft_lines').delete().eq('id', fromLine.id)
  }
  // 振替先へ加算（既存行にマージ・無ければ追加）
  for (const a of exAllocs) {
    const { data: ex } = await supabaseAdmin.from('ubiregi_journal_draft_lines')
      .select('id, amount').eq('draft_id', draftId).eq('side', 'credit')
      .eq('account_name', '売上高').eq('sub_account_name', a.sub).eq('tax_rate', 0.1)
    if (ex?.[0]) {
      await supabaseAdmin.from('ubiregi_journal_draft_lines').update({ amount: ex[0].amount + a.amountEx }).eq('id', ex[0].id)
    } else {
      const { data: maxRow } = await supabaseAdmin.from('ubiregi_journal_draft_lines')
        .select('sort_order').eq('draft_id', draftId).order('sort_order', { ascending: false }).limit(1)
      await supabaseAdmin.from('ubiregi_journal_draft_lines').insert({
        draft_id: draftId, side: 'credit', account_name: '売上高', sub_account_name: a.sub,
        tax_rate: 0.1, amount: a.amountEx, sort_order: (maxRow?.[0]?.sort_order ?? 0) + 1, memo: '補正で追加',
      })
    }
  }
  // 監査記録＋該当review_itemの解決
  await supabaseAdmin.from('ubiregi_journal_draft_overrides').insert({
    draft_id: draftId, kind: 'sales_reclass',
    original: { side: 'credit', account: '売上高', sub: fromSub, amount_incl: fromAmountIncl, amount_ex: fromEx },
    replacement: exAllocs.map(a => ({ sub: a.sub, amount_incl: a.amountIncl, amount_ex: a.amountEx })),
    reason: reason.trim(),
  })
  await supabaseAdmin.from('ubiregi_journal_review_items')
    .update({ resolved: true }).eq('draft_id', draftId).like('reason', '要確認商品%')

  const { balanced, unresolved } = await recomputeDraft(draftId)
  return {
    ok: true,
    message: unresolved === 0 && balanced
      ? '補正を適用しました。貸借一致＝この日は送信可能になりました'
      : `補正を適用しました（残り未確定${unresolved}件${balanced ? '' : '・貸借未一致'}）`,
  }
}
