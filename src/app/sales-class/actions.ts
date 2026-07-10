'use server'

import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'

// 売上区分マッピングの編集（category_map / product_category_overrides とも UPSERT のみ・DELETEしない）。
// 反映タイミング: 次回のドラフト生成（毎日4:10 cron / mf-send の日次リセット）から。
// 送信済み(sent)の日は generate_journal_drafts.mjs 側で再生成スキップされるため影響しない。

export type SaveResult = { ok: boolean; message: string }

const CLASSES = ['food', 'drink', 'other'] as const
type SalesClass = (typeof CLASSES)[number]

function isSalesClass(v: string): v is SalesClass {
  return (CLASSES as readonly string[]).includes(v)
}

export async function upsertCategoryClassAction(
  accountId: number,
  categoryName: string,
  salesClass: string,
): Promise<SaveResult> {
  if (!Number.isInteger(accountId) || accountId <= 0) return { ok: false, message: '不正な店舗ID' }
  if (!categoryName) return { ok: false, message: 'カテゴリ名が空です' }
  if (!isSalesClass(salesClass)) return { ok: false, message: `不正な区分: ${salesClass}` }

  const { error } = await supabaseAdmin
    .from('ubiregi_category_map')
    .upsert(
      {
        account_id: accountId,
        category_name: categoryName,
        sales_class: salesClass,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,category_name' },
    )
  if (error) return { ok: false, message: `保存エラー: ${error.message}` }

  revalidatePath('/sales-class')
  return { ok: true, message: `カテゴリ「${categoryName}」を保存しました` }
}

// salesClass='default' はオーバーライド解除（is_active=false・行は監査用に残す）
export async function setProductOverrideAction(
  accountId: number,
  menuItemId: number,
  menuItemName: string,
  categoryName: string | null,
  salesClass: string,
  note: string,
): Promise<SaveResult> {
  if (!Number.isInteger(accountId) || accountId <= 0) return { ok: false, message: '不正な店舗ID' }
  if (!Number.isInteger(menuItemId) || menuItemId <= 0) return { ok: false, message: '不正な商品ID' }
  if (!menuItemName) return { ok: false, message: '商品名が空です' }

  if (salesClass === 'default') {
    const { error } = await supabaseAdmin
      .from('ubiregi_product_category_overrides')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('menu_item_id', menuItemId)
    if (error) return { ok: false, message: `解除エラー: ${error.message}` }
    revalidatePath('/sales-class')
    return { ok: true, message: `「${menuItemName}」のオーバーライドを解除しました（カテゴリ既定に戻ります）` }
  }

  if (!isSalesClass(salesClass)) return { ok: false, message: `不正な区分: ${salesClass}` }

  const { error } = await supabaseAdmin
    .from('ubiregi_product_category_overrides')
    .upsert(
      {
        account_id: accountId,
        menu_item_id: menuItemId,
        menu_item_name: menuItemName,
        category_name: categoryName,
        sales_class: salesClass,
        is_active: true,
        note: note.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,menu_item_id' },
    )
  if (error) return { ok: false, message: `保存エラー: ${error.message}` }

  revalidatePath('/sales-class')
  return { ok: true, message: `「${menuItemName}」を上書きしました（次回生成分から反映）` }
}
