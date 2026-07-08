export const metadata = { title: 'MF送信' }
export const dynamic = 'force-dynamic'

import { supabaseAdmin } from '@/lib/supabase-admin'
import MfSendClient, { type DraftRow, type DraftLine } from './MfSendClient'

async function getData() {
  const [draftsRes, linesRes, storesRes, unitsRes] = await Promise.all([
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
  ])
  if (draftsRes.error) throw new Error(draftsRes.error.message)
  if (linesRes.error) throw new Error(linesRes.error.message)
  if (storesRes.error) throw new Error(storesRes.error.message)
  if (unitsRes.error) throw new Error(unitsRes.error.message)

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
  return { drafts, lines: (linesRes.data ?? []) as DraftLine[], deptNames }
}

export default async function MfSendPage() {
  const { drafts, lines, deptNames } = await getData()
  return <MfSendClient drafts={drafts} lines={lines} deptNames={deptNames} />
}
