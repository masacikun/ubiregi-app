import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { Suspense } from 'react'
import NavBar from '@/components/NavBar'
import { ThemeProvider } from '@/components/ThemeProvider'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: '番頭さん｜ユビレジ分析',
  description: 'ユビレジ POSデータ 売上・商品分析ダッシュボード',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={geist.variable} suppressHydrationWarning>
      <body className="bg-gray-50 dark:bg-gray-950 min-h-screen antialiased transition-colors">
        <ThemeProvider>
          <Suspense fallback={<header className="bg-slate-900 h-14 shadow-lg" />}>
            <NavBar />
          </Suspense>
          <main className="w-full px-4 py-6">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  )
}
