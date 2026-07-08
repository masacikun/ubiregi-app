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
- **2026-07-09 TZバグ修正**: parse_db_dt() が +09:00 オフセットを剥がしUTC扱いにしていたため、増分の since が9時間未来へシフト（毎日 前日03:00〜11:50 JST頃の更新分がどのrunにも入らない構造）。オフセット保持でパース→UTC正規化に修正。欠損していた 5/13（19023・closed 15会計 ¥267,135）は --since/--until 再取込で補填済み（分析用・MF送信対象外）
- --since/--until の明示レンジ実行は pytz 使用（2026-07-09 venv に追加。requirements.txt は無し）
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
- 対象=closed・営業日>=2026-06-01（6/1足切り）。**営業日=深夜5時カットオフ**（JST 05:00までの会計は前日の営業日に計上。2026-07-09切替・EPARK等の営業日ベース照合と一致。businessDate()/jstStartUtc()で定義）。
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


## MF送信UI（フェーズ4-1→4-2-1でカレンダー化・2026-07-09/10）

`/u/mf-send` — 日次×店の仕訳ドラフトを**月カレンダー**（中洲・西新を並列表示、モバイルは縦積み）で表示し、クリーンな日（review_required=false）を送信前プレビュー→ボタンでMF送信。

- カレンダー: 月切替（◀▶）・各日セルに税込売上＋状態バッジ（送信済=緑・送信可=青・要確認=黄+理由tooltip）。ドラフトが無い過去日は「売上なし」・未来日/開店前は空欄。セルの税込は total_credit+consumption_tax（=checkouts.total合計。要確認日でも欠けない値）。
- 照合ヘッダ（店×月）: 売上税抜/消費税/税込/会計数＋送信済み/未送信/要確認の日数（MF試算表との照合用）。
- プレビュー: 借方（現金/売掛金・税込・取引先・部門）／貸方（売上高・税抜・税率・部門）／貸借一致チェック表示／摘要。不一致時は送信ボタン無効。
- 送信: src/app/mf-send/actions.ts が **mf-accounting-sync/scripts/ubiregi_journal_send.mjs をexecFileで呼ぶ**（3-A確定ロジックの完全再利用・重複実装なし）。二重送信ガード（条件付きロック＋remark1行目一致＋sent保護＋6/1足切り）はCLI側で担保、UI側でも事前バリデーション。
- 要確認13日はボタン非表示（4-2で対応）。原本・ドラフトの編集機能は無し（閲覧＋送信のみ）。
- スクリプト置き場は env MF_SEND_APP_DIR で変更可（既定 /var/www/mf-accounting-sync）。


## 要確認日の画面対応（フェーズ4-2-2・2026-07-09）

/u/mf-send のプレビュー内で要確認日を確定できる：

- **複数決済の半自動確定**: review_itemsに退避した会計ごとに決済内訳を表示し、payment_mapから借方（科目/補助/取引先）を自動提案。現金は**checkouts.total−他決済の逆算**（payments.amountの預かり金は使わない）。配分合計=会計合計・マイナス無し・借方先選択済みのときのみ確定可。確定でdraft_linesに借方行追加（memoにco=会計ID）・review_items.resolved=true。
- **イレギュラー補正（7/2型）**: 「要確認商品」フラグのある日限定。売上高の補助間振替（例: その他→フード/ドリンク・税込指定・税10%固定・税抜変換はΣ保存の端数調整）。理由必須・元値と理由は ubiregi_journal_draft_overrides に監査記録（原本checkouts/itemsは不変更）。カレンダーセルに「補」マーク＋プレビューに補正記録を表示。
- 未確定ゼロ＋貸借一致（借方税込=貸方税抜+税）になると review_required=false → クリーン日と同じ送信フローで送信可能。
- 注意: 生成スクリプト再実行は未送信ドラフトを作り直すため**手動確定・補正は消える**（確定→早めに送信の運用。生成ボタン実装時に保護予定）。
