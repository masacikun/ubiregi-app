'use client'

type MonthlySales = {
  sale_month: string
  checkout_count: number
  total: number
  avg_checkout_value: number
  discount_amount: number
}

type PaymentData = { name: string; amount: number }

type Props = {
  monthlySales: MonthlySales[]
  paymentData: PaymentData[]
}

function fmt(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })
}

export default function SalesClient({ monthlySales, paymentData }: Props) {
  const maxTotal = Math.max(...monthlySales.map(m => m.total), 1)
  const totalPayment = paymentData.reduce((s, p) => s + p.amount, 0)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-700">売上分析</h1>

      {/* 月別売上テーブル */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-600 mb-4">月別売上推移（直近12ヶ月）</h2>

        {/* バーグラフ */}
        <div className="flex items-end gap-1 mb-6 h-32">
          {monthlySales.map(m => {
            const pct = (m.total / maxTotal) * 100
            const label = new Date(m.sale_month).toLocaleDateString('ja-JP', { month: 'short' })
            return (
              <div key={m.sale_month} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
                  <div
                    className="w-full bg-blue-400 group-hover:bg-blue-600 rounded-t transition-all relative"
                    style={{ height: `${pct}%` }}
                    title={fmt(m.total)}
                  />
                </div>
                <span className="text-xs text-slate-400">{label}</span>
              </div>
            )
          })}
        </div>

        {/* テーブル */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 text-xs text-slate-400 font-medium">月</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">売上</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">会計数</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">客単価</th>
                <th className="text-right py-2 text-xs text-slate-400 font-medium">値引き</th>
              </tr>
            </thead>
            <tbody>
              {monthlySales.map(m => (
                <tr key={m.sale_month} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 text-slate-600">
                    {new Date(m.sale_month).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}
                  </td>
                  <td className="py-2 text-right font-semibold text-slate-700">{fmt(m.total)}</td>
                  <td className="py-2 text-right text-slate-500">{m.checkout_count.toLocaleString()}</td>
                  <td className="py-2 text-right text-slate-500">{fmt(Math.round(m.avg_checkout_value))}</td>
                  <td className="py-2 text-right text-red-400">{fmt(m.discount_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 支払方法別 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-600 mb-4">支払方法別（直近30日）</h2>
        {paymentData.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-8">データがありません</p>
        ) : (
          <div className="space-y-3">
            {paymentData.map(p => {
              const pct = totalPayment > 0 ? (p.amount / totalPayment) * 100 : 0
              return (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="text-sm text-slate-600 w-28 shrink-0">{p.name}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 w-24 text-right shrink-0">{fmt(p.amount)}</span>
                  <span className="text-xs text-slate-400 w-10 text-right shrink-0">{pct.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
