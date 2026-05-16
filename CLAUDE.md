# ubiregi-app 開発ガイド

## システム概要
smile-mgmt のユビレジ売上分析アプリ。Next.js 16 App Router + PostgREST。
VPS: `/var/www/ubiregi-app` (PM2: `ubiregi-app`, port 3001, basePath: `/u`)

## 参照ドキュメント
- システム全体の構成・DB: /var/www/smile-mgmt/SYSTEM.md

## 作業完了後に必ず実行すること
1. /var/www/smile-mgmt/SYSTEM.md の更新履歴に追記
2. `git push origin main` → GitHub Actions が自動デプロイ
3. `cd /var/www/smile-mgmt && git add -A && git commit -m "..." && git push origin main`

## 技術スタック
- Next.js 16 (App Router, basePath: `/u`)
- TypeScript 5, Tailwind CSS v4
- @supabase/supabase-js
- Python venv: /var/www/ubiregi-app/venv/（sync_ubiregi.py）

## ページルーティング
| URL | 概要 |
|-----|------|
| `/u` | ダッシュボード（売上サマリー・KPI） |
| `/u/sales` | 売上分析（日別・月別） |
| `/u/items` | 商品分析（商品別売上・ランキング） |

## 自動同期
- 毎日AM3:00 cron で sync_ubiregi.py 実行
- ログ: /var/log/ubiregi-sync.log

## デプロイ
```bash
git push origin main  # GitHub Actions が自動ビルド・pm2 restart
```
