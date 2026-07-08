// ユビレジ売上 → 日次×店別 複合仕訳ドラフト生成（フェーズ2）
// 使い方: node scripts/generate_journal_drafts.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//   デフォルト: 2026-06-01 〜 今日(JST)。6/1足切り＝HYD開始日より前は生成しない。
// 冪等: 同(business_date, account_id)は作り直し。ただし send_status='sent' は保護（スキップ）。
// 金額規約（2026-07-09 向き修正）: 借方(debit)=現金/売掛金・税込(checkouts.total起点・部門/取引先付き)
//           / 貸方(credit)=売上高・税抜(明細subtotalネット・部門付き)。
//           借方に payments.amount の生値は使わない（現金は預かり金のため）。
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HYD_START = '2026-06-01' // 6/1足切り（旧法人分は生成しない）

function loadEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}
const env = loadEnv(path.join(APP_ROOT, '.env.local'))
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
// realtimeは未使用。Node20はネイティブWebSocketが無くsupabase-js初期化で落ちるためダミーtransportを渡す
const sb = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: class DummyWs {} },
})

// 営業日定義（2026-07-09切替: 深夜5時カットオフ＝JST 05:00までの会計は前日の営業日に計上。まさし決定）
// 例: 7/3 00:59 の会計 → 営業日 7/2。EPARK等の営業日ベース照合と一致させる。
function businessDate(paidAt) {
  return new Date(new Date(paidAt).getTime() + (9 - 5) * 3600 * 1000).toISOString().slice(0, 10)
}
function jstStartUtc(dateStr) { return `${dateStr}T05:00:00+09:00` } // 営業日Dの開始=D 05:00 JST
function todayJst() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10) }

async function fetchAll(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}
function chunk(arr, n) {
  const r = []
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n))
  return r
}

const args = process.argv.slice(2)
function argOf(name, def) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const FROM = argOf('--from', HYD_START) < HYD_START ? HYD_START : argOf('--from', HYD_START)
const TO = argOf('--to', todayJst())

const CLASS_JA = { food: 'フード', drink: 'ドリンク', other: 'その他' }

async function main() {
  console.log(`=== 仕訳ドラフト生成 ${FROM} 〜 ${TO}（JST営業日） ===`)

  // 対応表ロード
  const catRows = await fetchAll(() => sb.from('ubiregi_category_map').select('*').eq('is_active', true))
  const payRows = await fetchAll(() => sb.from('ubiregi_payment_map').select('*').eq('is_active', true))
  const flagRows = await fetchAll(() => sb.from('menu_item_review_flags').select('*').eq('is_active', true))
  const upm = await fetchAll(() => sb.from('unit_pos_mappings').select('external_id, unit_id').eq('pos_type', 'ubiregi'))
  const units = await fetchAll(() => sb.from('units').select('id, code'))
  const catMap = new Map(catRows.map(r => [`${r.account_id ?? 'null'}|${r.category_name}`, r]))
  const payMap = new Map(payRows.map(r => [`${r.account_id ?? 'null'}|${r.payment_type_name}`, r]))
  const flagMap = new Map(flagRows.map(r => [r.menu_item_name, r.reason]))
  const unitCode = new Map(units.map(u => [u.id, u.code]))
  const deptByAccount = new Map(upm.map(m => [Number(m.external_id), unitCode.get(m.unit_id)]))

  // 会計・明細・決済ロード
  const checkouts = await fetchAll(() =>
    sb.from('ubiregi_checkouts')
      .select('id, account_id, subtotal, tax_amount, total, paid_at')
      .eq('status', 'closed')
      .gte('paid_at', jstStartUtc(FROM))
      .lt('paid_at', jstStartUtc(nextDay(TO)))
      .order('id'))
  const ids = checkouts.map(c => c.id)
  const items = [], payments = []
  for (const part of chunk(ids, 100)) {
    items.push(...await fetchAll(() => sb.from('ubiregi_checkout_items')
      .select('checkout_id, menu_item_name, category_name, tax_rate, tax_type, subtotal').in('checkout_id', part).order('id')))
    payments.push(...await fetchAll(() => sb.from('ubiregi_checkout_payments')
      .select('checkout_id, payment_type_name, amount').in('checkout_id', part).order('id')))
  }
  const itemsByCo = groupBy(items, i => i.checkout_id)
  const paysByCo = groupBy(payments, p => p.checkout_id)
  console.log(`対象: 会計${checkouts.length}件 / 明細${items.length}行 / 決済${payments.length}行`)

  // 日次×店に集約
  const days = new Map() // key: date|account
  for (const co of checkouts) {
    const key = `${businessDate(co.paid_at)}|${co.account_id}`
    if (!days.has(key)) days.set(key, { checkouts: [] })
    days.get(key).checkouts.push(co)
  }

  const report = { generated: 0, skippedSent: 0, reviewDays: 0, reasonCount: {}, balanceNg: [], fallbackRates: 0, unknown: new Set() }

  for (const [key, day] of [...days.entries()].sort()) {
    const [bdate, accStr] = key.split('|')
    const accountId = Number(accStr)
    const dept = deptByAccount.get(accountId)
    if (!dept) throw new Error(`部門未解決: account_id=${accountId}（unit_pos_mappingsに行がありません）`)

    const salesAgg = new Map()   // `${class}|${rate}` -> sum(税抜) → 貸方=売上高
    const payAgg = new Map()     // `${acct}|${sub}|${partner}` -> sum(checkouts.total 税込) → 借方=現金/売掛金
    const reasons = new Set()
    const reviewItems = []
    let taxSum = 0

    for (const co of day.checkouts) {
      taxSum += Number(co.tax_amount)

      for (const it of itemsByCo.get(co.id) ?? []) {
        const cm = catMap.get(`${accountId}|${it.category_name}`) ?? catMap.get(`null|${it.category_name}`)
        let cls = cm?.sales_class
        if (!cm) {
          cls = 'other'
          reasons.add(`未知カテゴリ:${it.category_name}`)
          report.unknown.add(`カテゴリ:${it.category_name}`)
          reviewItems.push({ checkout_id: co.id, reason: `未知カテゴリ:${it.category_name}`, detail: { menu_item_name: it.menu_item_name, subtotal: Number(it.subtotal) } })
        } else if (cm.needs_review) {
          reasons.add(`要確認カテゴリ:${it.category_name}`)
        }
        const fr = flagMap.get(it.menu_item_name)
        if (fr) {
          reasons.add(`要確認商品:${it.menu_item_name}`)
          reviewItems.push({ checkout_id: co.id, reason: `要確認商品:${it.menu_item_name}`, detail: { flag_reason: fr, subtotal: Number(it.subtotal), checkout_total: Number(co.total) } })
        }
        let rate = Number(it.tax_rate)
        if (rate !== 0.1 && rate !== 0.08) {
          report.fallbackRates++
          console.log(`  [税率フォールバック→10%] ${bdate} co=${co.id} ${it.menu_item_name} tax_rate=${it.tax_rate}`)
          rate = 0.1
        }
        // 売上（貸方）は税抜で計上する。intax（内税）明細の subtotal は税込のため税抜化する
        const net = it.tax_type === 'intax' ? Number(it.subtotal) / (1 + rate) : Number(it.subtotal)
        const k = `${cls}|${rate}`
        salesAgg.set(k, (salesAgg.get(k) ?? 0) + net)
      }

      const pays = paysByCo.get(co.id) ?? []
      if (pays.length === 1) {
        const p = pays[0]
        const pm = payMap.get(`${accountId}|${p.payment_type_name}`) ?? payMap.get(`null|${p.payment_type_name}`)
        if (!pm) {
          reasons.add(`未知決済:${p.payment_type_name}`)
          report.unknown.add(`決済:${p.payment_type_name}`)
          reviewItems.push({ checkout_id: co.id, reason: `未知決済:${p.payment_type_name}`, detail: { total: Number(co.total), payments: pays.map(x => ({ name: x.payment_type_name, amount: Number(x.amount) })) } })
        } else {
          const k = `${pm.credit_account_name}|${pm.credit_sub_account_name ?? ''}|${pm.trade_partner_name ?? ''}`
          payAgg.set(k, (payAgg.get(k) ?? 0) + Number(co.total)) // 必ずcheckouts.total起点（借方=入金）
        }
      } else if (pays.length > 1) {
        reasons.add('複数決済（貸方手動対応）')
        reviewItems.push({ checkout_id: co.id, reason: '複数決済', detail: { total: Number(co.total), payments: pays.map(x => ({ name: x.payment_type_name, amount: Number(x.amount) })) } })
      } else {
        reasons.add('決済レコード無し')
        reviewItems.push({ checkout_id: co.id, reason: '決済レコード無し', detail: { total: Number(co.total) } })
      }
    }

    // 行の組み立て（借方=現金/売掛金・税込／貸方=売上高・税抜。ゼロ行は出さない・ネットマイナスは要確認）
    const lines = []
    let sort = 1
    for (const [k, v0] of [...payAgg.entries()].sort()) {
      const v = Math.round(v0)
      if (v === 0) continue
      const [acct, sub, partner] = k.split('|')
      lines.push({ side: 'debit', account_name: acct, sub_account_name: sub || null, trade_partner_name: partner || null, tax_rate: null, amount: v, sort_order: sort++ })
    }
    for (const cls of ['food', 'drink', 'other']) {
      for (const rate of [0.1, 0.08]) {
        const v = Math.round(salesAgg.get(`${cls}|${rate}`) ?? 0)
        if (v === 0) continue
        if (v < 0) reasons.add(`ネットマイナス:${CLASS_JA[cls]}`)
        lines.push({ side: 'credit', account_name: '売上高', sub_account_name: CLASS_JA[cls], tax_rate: rate, amount: v, sort_order: sort++ })
      }
    }
    // 端数調整: 貸方（売上・税抜）合計は checkouts.subtotal（正）の日次合計に厳密一致させる。
    // intax税抜化の丸め残差（数円）を最大貸方行に吸収（会計慣行の端数調整・memoに明記）
    const creditTarget = Math.round(day.checkouts.reduce((s, co) => s + Number(co.subtotal), 0))
    const creditLines = lines.filter(l => l.side === 'credit')
    let residual = creditTarget - creditLines.reduce((s, l) => s + l.amount, 0)
    if (residual !== 0 && creditLines.length) {
      const biggest = creditLines.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a))
      biggest.amount += residual
      biggest.memo = `端数調整 ${residual > 0 ? '+' : ''}${residual}円含む（内税税抜化の丸め）`
      report.residualDays = (report.residualDays ?? 0) + 1
    }
    const totalDebit = lines.filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
    const totalCredit = creditLines.reduce((s, l) => s + l.amount, 0)
    const taxAmount = Math.round(taxSum)

    // 保存（sentは保護・それ以外は作り直し）
    const { data: existing, error: e1 } = await sb.from('ubiregi_journal_drafts')
      .select('id, send_status').eq('business_date', bdate).eq('account_id', accountId).maybeSingle()
    if (e1) throw new Error(e1.message)
    if (existing?.send_status === 'sent') {
      console.log(`  [保護] ${bdate} ${dept} は送信済みのためスキップ`)
      report.skippedSent++
      continue
    }
    if (existing) {
      const { error } = await sb.from('ubiregi_journal_drafts').delete().eq('id', existing.id).neq('send_status', 'sent')
      if (error) throw new Error(error.message)
    }
    const { data: draft, error: e2 } = await sb.from('ubiregi_journal_drafts').insert({
      business_date: bdate, account_id: accountId, department_code: dept,
      total_debit: totalDebit, consumption_tax_amount: taxAmount, total_credit: totalCredit,
      checkout_count: day.checkouts.length,
      review_required: reasons.size > 0, review_reasons: [...reasons],
      send_status: 'draft',
    }).select('id').single()
    if (e2) throw new Error(e2.message)
    if (lines.length) {
      const { error } = await sb.from('ubiregi_journal_draft_lines').insert(lines.map(l => ({ ...l, draft_id: draft.id })))
      if (error) throw new Error(error.message)
    }
    if (reviewItems.length) {
      const { error } = await sb.from('ubiregi_journal_review_items').insert(reviewItems.map(r => ({ ...r, draft_id: draft.id })))
      if (error) throw new Error(error.message)
    }

    report.generated++
    if (reasons.size) {
      report.reviewDays++
      for (const r of reasons) report.reasonCount[r.split(':')[0]] = (report.reasonCount[r.split(':')[0]] ?? 0) + 1
    }
    // 貸借検算: 複数決済/未知決済が無い日は 借方(税込)=貸方(税抜)+税 が1円まで一致するはず
    const hasDebitGap = [...reasons].some(r => r.startsWith('複数決済') || r.startsWith('未知決済') || r.startsWith('決済レコード無し'))
    if (!hasDebitGap && totalDebit !== totalCredit + taxAmount) {
      report.balanceNg.push({ bdate, dept, totalDebit, taxAmount, totalCredit, diff: totalDebit - totalCredit - taxAmount })
    }
  }

  console.log('\n=== 結果 ===')
  console.log(`生成: ${report.generated}日分 / 送信済み保護スキップ: ${report.skippedSent}`)
  console.log(`要確認日数: ${report.reviewDays} 理由内訳:`, report.reasonCount)
  console.log(`税率フォールバック明細: ${report.fallbackRates}件`)
  console.log(`未知（翻訳表の穴）:`, report.unknown.size ? [...report.unknown] : 'なし')
  console.log(`貸借不一致（複数決済等を除くクリーン日で）: ${report.balanceNg.length}件`, report.balanceNg)
}
function nextDay(d) { return new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10) }
function groupBy(arr, f) {
  const m = new Map()
  for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x) }
  return m
}
main().catch(e => { console.error('❌', e.message); process.exit(1) })
