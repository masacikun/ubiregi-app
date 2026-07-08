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

## 画面構成

| URL | 画面 |
|---|---|
| `/` | ダッシュボード（KPI + 日別売上 + TOP5） |
| `/sales` | 売上分析（月別推移 + 支払方法別） |
| `/items` | 商品分析（カテゴリ別 + 商品ランキング） |
