-- 商品単位の売上区分オーバーライド（B方針 Phase1・2026-07-10）
-- 適用: sudo -u postgres psql -d smileapp_db -f db/ubiregi_product_category_overrides.sql
--
-- 目的: カテゴリ既定（ubiregi_category_map）と実態がズレる商品（例: 飲み放題 D1000円/D500円 が
--       「コース」カテゴリ所属で food に計上される）を、商品単位で food/drink/other に上書きする。
-- 参照: scripts/generate_journal_drafts.mjs が (account_id, menu_item_id) で優先解決する。
-- menu_item_id にハードFKは張らない（ユビレジ再同期でメニューマスタが入れ替わっても行を保持するため）。
-- 履歴管理なし・is_active で有効判定（兄弟テーブル ubiregi_category_map と同じ方針）。

CREATE TABLE ubiregi_product_category_overrides (
  id             serial PRIMARY KEY,
  account_id     bigint NOT NULL,
  menu_item_id   bigint NOT NULL,
  menu_item_name text NOT NULL,          -- 表示用デノーマライズ
  category_name  text,                   -- 文脈表示用デノーマライズ（登録時点の所属カテゴリ）
  sales_class    text NOT NULL CHECK (sales_class IN ('food', 'drink', 'other')),
  is_active      boolean DEFAULT true,
  note           text,                   -- 上書き理由（任意）
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (account_id, menu_item_id)      -- 1商品1区分・編集はUPSERT
);

GRANT ALL ON ubiregi_product_category_overrides TO service_role;
GRANT USAGE, SELECT ON SEQUENCE ubiregi_product_category_overrides_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
