import type { Metadata } from 'next'
import NavBar from '@/components/NavBar'
import './globals.css'

export const metadata: Metadata = {
  title: 'ユビレジ 売上分析',
  description: 'ユビレジ POSデータ 売上・商品分析ダッシュボード',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-slate-50 min-h-screen">
        <NavBar />
        <main className="w-full px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  )
}
