# ubiregi-app 開発ガイド

## システム概要

smile-mgmt のユビレジ売上分析アプリ。Next.js 16 App Router + Supabase。  
VPS: `/var/www/ubiregi-app` (PM2: `ubiregi-app`, port 3001, basePath: `/u`)

## 作業完了後に必ず実行すること

1. **README.md を更新する** — 変更内容に合わせてこのリポジトリの README.md を修正する
2. **VPS の SYSTEM.md を更新する** — `ssh smileadmin@smile-mgmt.xvps.jp` で `/var/www/SYSTEM.md` を編集し、変更内容を更新履歴に追記する
3. **GitHub に push する** — main ブランチに push して GitHub Actions で VPS へデプロイする

## 作業ルール
- 作業完了後は必ず git add . && git commit && git push を実行すること
- コミットメッセージは変更内容を日本語で簡潔に書くこと

## 技術スタック

- Next.js 16.2.6 (App Router, basePath: `/u`)
- React 19.2.4, TypeScript 5, Tailwind CSS v4, Geist フォント
- @supabase/supabase-js ^2.105.4

## ページルーティング

| URL | 概要 |
|-----|------|
| `/u` | ダッシュボード (売上サマリー・KPI) |
| `/u/sales` | 売上分析 (日別・月別) |
| `/u/items` | 商品分析 (商品別売上・ランキング) |

## デプロイ

```bash
git push origin main  # GitHub Actions が自動ビルド・pm2 restart
```

VPS 手動:
```bash
ssh smileadmin@smile-mgmt.xvps.jp
cd /var/www/ubiregi-app && npm ci && npm run build && pm2 restart ubiregi-app
```
