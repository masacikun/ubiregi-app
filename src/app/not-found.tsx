export const dynamic = 'force-dynamic'

export default function NotFound() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="text-center">
        <p className="text-6xl font-bold text-gray-300 mb-4">404</p>
        <p className="text-gray-500">ページが見つかりません</p>
      </div>
    </div>
  )
}
