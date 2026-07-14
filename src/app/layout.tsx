import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { Suspense } from 'react'
import NavBar from '@/components/NavBar'
import AuthGuard from '@/components/AuthGuard'
import { ThemeProvider } from '@/components/ThemeProvider'
import { fetchStores } from '@/lib/stores-server'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: {
    default: '番頭さん｜ユビレジ分析',
    template: '番頭さん｜ユビレジ分析｜%s',
  },
  description: 'ユビレジ POSデータ 売上・商品分析ダッシュボード',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const stores = await fetchStores()
  return (
    <html lang="ja" className={geist.variable} suppressHydrationWarning>
      <body className="bg-gray-50 dark:bg-gray-950 min-h-screen antialiased transition-colors">
        <AuthGuard />
        <ThemeProvider>
          <Suspense fallback={<header className="bg-slate-900 h-14 shadow-lg" />}>
            <NavBar stores={stores} />
          </Suspense>
          <main className="w-full px-4 py-6">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  )
}
