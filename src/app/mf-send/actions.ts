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
  if (draft.review_required) return { ok: false, message: '要確認の日は送信できません（4-2で対応予定）' }
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
