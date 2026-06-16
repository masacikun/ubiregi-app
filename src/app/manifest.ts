import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '番頭さん',
    short_name: '番頭さん',
    description: '番頭さん 総合管理システム',
    start_url: '/u/',
    scope: '/u/',
    display: 'standalone',
    background_color: '#f4ecd8',
    theme_color: '#2b3a55',
    icons: [
      { src: '/u/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/u/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/u/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  }
}
