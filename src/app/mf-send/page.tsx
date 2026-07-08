export const metadata = { title: 'MF送信' }
export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase-admin'
import MfSendClient, { type DraftRow, type DraftLine, type ReviewItem, type PaymentMapRow, type OverrideRow } from './MfSendClient'

async function getData() {
  const [draftsRes, linesRes, storesRes, unitsRes, itemsRes, pmRes, ovRes] = await Promise.all([
    supabaseAdmin
      .from('ubiregi_journal_drafts')
      .select('*')
      .order('business_date', { ascending: false })
      .order('department_code'),
    supabaseAdmin
      .from('ubiregi_journal_draft_lines')
      .select('draft_id, side, account_name, sub_account_name, trade_partner_name, tax_rate, amount, sort_order, memo')
      .order('sort_order'),
    supabaseAdmin.from('stores').select('ubiregi_account_id, current_name'),
    supabaseAdmin.from('units').select('code, name'),
    supabaseAdmin
      .from('ubiregi_journal_review_items')
      .select('id, draft_id, checkout_id, reason, detail, resolved')
      .order('id'),
    supabaseAdmin
      .from('ubiregi_payment_map')
      .select('account_id, payment_type_name, credit_account_name, credit_sub_account_name, trade_partner_name, is_deposit_amount')
      .eq('is_active', true),
    supabaseAdmin
      .from('ubiregi_journal_draft_overrides')
      .select('id, draft_id, kind, original, replacement, reason, created_at')
      .order('id'),
  ])
  for (const r of [draftsRes, linesRes, storesRes, unitsRes, itemsRes, pmRes, ovRes]) {
    if (r.error) throw new Error(r.error.message)
  }

  const storeNames = new Map<number, string>(
    (storesRes.data ?? [])
      .filter(s => s.ubiregi_account_id != null)
      .map(s => [Number(s.ubiregi_account_id), s.current_name as string]),
  )
  const drafts: DraftRow[] = (draftsRes.data ?? []).map(d => ({
    id: d.id,
    business_date: d.business_date,
    account_id: Number(d.account_id),
    store_name: storeNames.get(Number(d.account_id)) ?? `店舗 ${d.account_id}`,
    department_code: String(d.department_code),
    total_debit: d.total_debit,
    consumption_tax_amount: d.consumption_tax_amount,
    total_credit: d.total_credit,
    checkout_count: d.checkout_count,
    review_required: d.review_required,
    review_reasons: d.review_reasons ?? [],
    send_status: d.send_status,
    mf_journal_id: d.mf_journal_id,
    generated_at: d.generated_at,
  }))
  const deptNames = Object.fromEntries((unitsRes.data ?? []).map(u => [String(u.code), u.name as string]))
  return {
    drafts,
    lines: (linesRes.data ?? []) as DraftLine[],
    deptNames,
    reviewItems: (itemsRes.data ?? []) as ReviewItem[],
    paymentMap: (pmRes.data ?? []) as PaymentMapRow[],
    overrides: (ovRes.data ?? []) as OverrideRow[],
  }
}

export default async function MfSendPage() {
  const data = await getData()
  return <MfSendClient {...data} />
}
