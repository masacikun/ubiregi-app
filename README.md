# ubiregi-app

番頭さん（総合管理システム）のユビレジ POSデータ 売上・商品分析アプリ。
budget-app（売上予算実績管理）と同じ Supabase プロジェクトに相乗りする。

---

## セットアップ

### 1. `.env.local` を作成

```bash
cp .env.local.example .env.local
```

budget-app の `.env.local` から以下をコピーするだけでOK：
```env
NEXT_PUBLIC_SUPABASE_URL=（budget-appと同じ値）
NEXT_PUBLIC_SUPABASE_ANON_KEY=（budget-appと同じ値）
SUPABASE_SERVICE_ROLE_KEY=（budget-appと同じ値）

# ユビレジAPIトークン（ユビレジ管理画面で発行）
UBIREGI_API_TOKEN=your_token
UBIREGI_ACCOUNT_ID=your_account_id

# budget-appのURL（NavBarのリンクに使用）
NEXT_PUBLIC_BUDGET_APP_URL=http://localhost:3000
```

### 2. Supabaseにテーブルを作成

Supabase Dashboard → SQL Editor を開いて `supabase_schema.sql` の内容を貼り付けて実行。

### 3. 初回データ同期

```bash
pip install requests supabase python-dotenv pytz
python sync_ubiregi.py --full
```

### 4. アプリを起動

```bash
npm install
npm run dev  # → http://localhost:3001
```

budget-appと同時に起動する場合は `package.json` の dev を `next dev -p 3001` に変更。

---

## budget-appへのリンク追加

`NavBar.tsx.patch` の内容を budget-app の `src/components/NavBar.tsx` に上書きコピー。

budget-app の `.env.local` に追加：
```env
NEXT_PUBLIC_UBIREGI_APP_URL=http://localhost:3001
```

---

## 増分同期（定期実行）

```bash
# 手動で増分同期（デフォルト店＝UBIREGI_API_TOKEN の店舗のみ）
python sync_ubiregi.py

# 全店舗一括（.env.local の UBIREGI_STORE_N_TOKEN / _ACCOUNT_ID を全て対象）
python sync_ubiregi.py --all-stores

# 特定期間の再同期
python sync_ubiregi.py --since 2024-06-01 --until 2024-06-30
```

本番cron（毎日3:00・全店舗）。ログは /var/log 直下ではなく**アプリ配下 logs/**（smileadmin所有・
/var/log は smileadmin が新規作成不可でリダイレクト失敗→同期停止の障害が起きたため。2026-07-08根治）：
```cron
0 3 * * * cd /var/www/ubiregi-app && /var/www/ubiregi-app/venv/bin/python3 sync_ubiregi.py --all-stores >> /var/www/ubiregi-app/logs/ubiregi-sync.log 2>&1
```
- rotate は /etc/logrotate.d/bantosan-apps（weekly・8世代・copytruncate）
- DB接続は SUPABASE_URL（内部PostgREST 127.0.0.1:3101）優先。公開URLはauth_request保護のためスクリプトからは不可
- 店舗ごとに sync_logs の最終success−10分から増分。新店（前回同期なし）は自動フル同期
- 1店舗のエラー（トークン失効等）は sync_logs に記録して次店舗へ継続

---

## MF会計 送信用 翻訳表（2026-07-08新設・フェーズ1）

ユビレジ売上→MF仕訳送信用の対応表3テーブル（smileapp_db・service_roleのみ）：

| テーブル | 内容 |
|---|---|
| ubiregi_category_map | 店×カテゴリ→3分類（food/drink/other＝MF補助 フード/ドリンク/その他）。36行（中洲25＋西新11）。UNIQUE(account_id, category_name) |
| ubiregi_payment_map | payment_type_name→MF貸方（勘定科目＋補助）。現金は店別補助＋is_deposit_amount=true（預かり金＝金額はcheckouts.total起点）。11行 |
| menu_item_review_flags | 商品名ベースの要確認フラグ（「その他料金」等・MF送信前に人が確認） |

- 税率は表に持たない（明細tax_rateを正とし生成時に判定）。
- needs_review=true の行は仕訳生成時に要確認扱い。
- 個別案件・確定ルールは smile-mgmt/docs/仕訳ルール集.md を参照。

### 日次仕訳ドラフト生成（フェーズ2・2026-07-09）

ドラフト3テーブル: ubiregi_journal_drafts（日次×店ヘッダ・UNIQUE(business_date,account_id)・send_status='sent'は再生成から保護）／ubiregi_journal_draft_lines（**借方=現金/売掛金・税込・取引先付き／貸方=売上高・税抜×税率**。2026-07-09向き修正）／ubiregi_journal_review_items（複数決済等の人手対応退避）。

実行（手動・cron化しない＝人が確認する運用）:
```bash
cd /var/www/ubiregi-app
node scripts/generate_journal_drafts.mjs              # 2026-06-01〜今日(JST)
node scripts/generate_journal_drafts.mjs --from 2026-07-01 --to 2026-07-31
```

生成仕様の要点:
- 対象=closed・paid_at>=2026-06-01（6/1足切り）。営業日=JST暦日（businessDate()に分離・将来変更可）。
- **貸方（売上高）**は明細subtotalを税抜化して集計（**intax明細のsubtotalは税込**のため /(1+rate)。丸め残差は最大貸方行で端数調整しmemo明記）→ 日次貸方合計=checkouts.subtotal合計に厳密一致。
- **借方（現金/売掛金）**は必ずcheckouts.total起点（payments.amountの生値は使わない＝現金預かり金対策）。売掛系のみ取引先（payment_map.trade_partner_name→MF取引先code）。複数決済・未知決済はreview_itemsへ退避し借方に自動計上しない。
- 要確認フラグ: menu_item_review_flags該当（その他料金等）／needs_reviewカテゴリ／複数決済／未知カテゴリ・未知決済／ネットマイナス。
- 部門はunit_pos_mappings→units.codeで解決（201=中洲19023・202=西新42765）。
- MF送信（journal.write）・UIは次フェーズ。

## 画面構成

| URL | 画面 |
|---|---|
| `/` | ダッシュボード（KPI + 日別売上 + TOP5） |
| `/sales` | 売上分析（月別推移 + 支払方法別） |
| `/items` | 商品分析（カテゴリ別 + 商品ランキング） |
