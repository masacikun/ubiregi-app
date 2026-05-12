-- ============================================================
-- ユビレジ DWH テーブル定義（Supabase用）
-- budget-appと同じSupabaseプロジェクトに追加する
-- Supabase Dashboard → SQL Editor に貼り付けて実行
-- ============================================================

-- ============================================================
-- マスタテーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS ubiregi_cashiers (
    id          BIGINT PRIMARY KEY,
    account_id  BIGINT NOT NULL,
    name        TEXT NOT NULL,
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    raw_data    JSONB,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ubiregi_payment_types (
    id              BIGINT PRIMARY KEY,
    account_id      BIGINT NOT NULL,
    name            TEXT NOT NULL,
    payment_method  TEXT,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    raw_data        JSONB,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ubiregi_categories (
    id            BIGINT PRIMARY KEY,
    account_id    BIGINT NOT NULL,
    name          TEXT NOT NULL,
    parent_id     BIGINT REFERENCES ubiregi_categories(id),
    display_order INTEGER,
    is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    raw_data      JSONB,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ubiregi_menu_items (
    id          BIGINT PRIMARY KEY,
    account_id  BIGINT NOT NULL,
    category_id BIGINT REFERENCES ubiregi_categories(id),
    name        TEXT NOT NULL,
    price       NUMERIC(12,2),
    cost_price  NUMERIC(12,2),
    tax_type    TEXT,
    tax_rate    NUMERIC(5,4),
    is_hidden   BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
    raw_data    JSONB,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ
);

-- ============================================================
-- 会計テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS ubiregi_checkouts (
    id              BIGINT PRIMARY KEY,
    account_id      BIGINT NOT NULL,
    cashier_id      BIGINT REFERENCES ubiregi_cashiers(id),
    table_name      TEXT,
    subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'closed',
    paid_at         TIMESTAMPTZ,
    raw_data        JSONB,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ubiregi_checkouts_paid_at    ON ubiregi_checkouts(paid_at);
CREATE INDEX IF NOT EXISTS idx_ubiregi_checkouts_updated_at ON ubiregi_checkouts(updated_at);

CREATE TABLE IF NOT EXISTS ubiregi_checkout_items (
    id              BIGINT PRIMARY KEY,
    checkout_id     BIGINT NOT NULL REFERENCES ubiregi_checkouts(id) ON DELETE CASCADE,
    account_id      BIGINT NOT NULL,
    menu_item_id    BIGINT REFERENCES ubiregi_menu_items(id),
    menu_item_name  TEXT NOT NULL,
    category_id     BIGINT REFERENCES ubiregi_categories(id),
    category_name   TEXT,
    quantity        NUMERIC(10,3) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
    cost_price      NUMERIC(12,2),
    tax_type        TEXT,
    tax_rate        NUMERIC(5,4),
    tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    raw_data        JSONB,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ubiregi_checkout_items_checkout_id  ON ubiregi_checkout_items(checkout_id);
CREATE INDEX IF NOT EXISTS idx_ubiregi_checkout_items_menu_item_id ON ubiregi_checkout_items(menu_item_id);

CREATE TABLE IF NOT EXISTS ubiregi_checkout_payments (
    id                BIGSERIAL PRIMARY KEY,
    checkout_id       BIGINT NOT NULL REFERENCES ubiregi_checkouts(id) ON DELETE CASCADE,
    account_id        BIGINT NOT NULL,
    payment_type_id   BIGINT REFERENCES ubiregi_payment_types(id),
    payment_type_name TEXT,
    payment_method    TEXT,
    amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
    raw_data          JSONB,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ubiregi_checkout_taxes (
    id             BIGSERIAL PRIMARY KEY,
    checkout_id    BIGINT NOT NULL REFERENCES ubiregi_checkouts(id) ON DELETE CASCADE,
    account_id     BIGINT NOT NULL,
    tax_type       TEXT,
    tax_rate       NUMERIC(5,4),
    taxable_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    raw_data       JSONB,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 同期ログ
CREATE TABLE IF NOT EXISTS ubiregi_sync_logs (
    id               BIGSERIAL PRIMARY KEY,
    sync_type        TEXT NOT NULL,
    target           TEXT NOT NULL,
    account_id       BIGINT,
    status           TEXT NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at      TIMESTAMPTZ,
    records_fetched  INTEGER NOT NULL DEFAULT 0,
    records_upserted INTEGER NOT NULL DEFAULT 0,
    since_datetime   TIMESTAMPTZ,
    until_datetime   TIMESTAMPTZ,
    error_message    TEXT,
    error_detail     TEXT
);

-- ============================================================
-- 分析ビュー
-- ============================================================

CREATE OR REPLACE VIEW v_daily_sales AS
SELECT
    account_id,
    DATE(paid_at AT TIME ZONE 'Asia/Tokyo') AS sale_date,
    COUNT(*)            AS checkout_count,
    SUM(subtotal)       AS subtotal,
    SUM(tax_amount)     AS tax_amount,
    SUM(total)          AS total,
    SUM(discount_amount) AS discount_amount,
    AVG(total)          AS avg_checkout_value
FROM ubiregi_checkouts
WHERE status = 'closed'
  AND paid_at IS NOT NULL
GROUP BY account_id, DATE(paid_at AT TIME ZONE 'Asia/Tokyo');

CREATE OR REPLACE VIEW v_monthly_sales AS
SELECT
    account_id,
    DATE_TRUNC('month', paid_at AT TIME ZONE 'Asia/Tokyo')::DATE AS sale_month,
    COUNT(*)            AS checkout_count,
    SUM(subtotal)       AS subtotal,
    SUM(tax_amount)     AS tax_amount,
    SUM(total)          AS total,
    SUM(discount_amount) AS discount_amount,
    AVG(total)          AS avg_checkout_value
FROM ubiregi_checkouts
WHERE status = 'closed'
  AND paid_at IS NOT NULL
GROUP BY account_id, DATE_TRUNC('month', paid_at AT TIME ZONE 'Asia/Tokyo')::DATE;

CREATE OR REPLACE VIEW v_item_sales_ranking AS
SELECT
    ci.account_id,
    ci.menu_item_id,
    ci.menu_item_name,
    ci.category_id,
    ci.category_name,
    COUNT(DISTINCT ci.checkout_id) AS checkout_count,
    SUM(ci.quantity)               AS total_quantity,
    SUM(ci.subtotal)               AS total_revenue,
    AVG(ci.unit_price)             AS avg_unit_price,
    SUM(ci.cost_price * ci.quantity) FILTER (WHERE ci.cost_price IS NOT NULL) AS total_cost,
    ROUND(
        SUM(ci.cost_price * ci.quantity) / NULLIF(SUM(ci.subtotal), 0) * 100, 2
    ) AS cost_rate_pct
FROM ubiregi_checkout_items ci
JOIN ubiregi_checkouts c ON c.id = ci.checkout_id
WHERE c.status = 'closed'
  AND c.paid_at IS NOT NULL
GROUP BY ci.account_id, ci.menu_item_id, ci.menu_item_name, ci.category_id, ci.category_name;

CREATE OR REPLACE VIEW v_category_sales AS
SELECT
    ci.account_id,
    ci.category_id,
    ci.category_name,
    COUNT(DISTINCT ci.checkout_id) AS checkout_count,
    SUM(ci.quantity)               AS total_quantity,
    SUM(ci.subtotal)               AS total_revenue
FROM ubiregi_checkout_items ci
JOIN ubiregi_checkouts c ON c.id = ci.checkout_id
WHERE c.status = 'closed'
  AND c.paid_at IS NOT NULL
GROUP BY ci.account_id, ci.category_id, ci.category_name;

CREATE OR REPLACE VIEW v_payment_breakdown AS
SELECT
    cp.account_id,
    DATE(c.paid_at AT TIME ZONE 'Asia/Tokyo') AS sale_date,
    cp.payment_method,
    cp.payment_type_name,
    COUNT(DISTINCT cp.checkout_id) AS checkout_count,
    SUM(cp.amount)                 AS total_amount
FROM ubiregi_checkout_payments cp
JOIN ubiregi_checkouts c ON c.id = cp.checkout_id
WHERE c.status = 'closed'
  AND c.paid_at IS NOT NULL
GROUP BY cp.account_id, DATE(c.paid_at AT TIME ZONE 'Asia/Tokyo'), cp.payment_method, cp.payment_type_name;
