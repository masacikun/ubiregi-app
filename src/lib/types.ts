export type UbiregiCheckout = {
  id: number
  account_id: number
  cashier_id: number | null
  table_name: string | null
  subtotal: number
  tax_amount: number
  total: number
  discount_amount: number
  status: string
  paid_at: string | null
  created_at: string | null
  updated_at: string | null
}

export type UbiregiCheckoutItem = {
  id: number
  checkout_id: number
  account_id: number
  menu_item_id: number | null
  menu_item_name: string
  category_id: number | null
  category_name: string | null
  quantity: number
  unit_price: number
  subtotal: number
  tax_rate: number | null
}

export type UbiregiMenuItem = {
  id: number
  account_id: number
  category_id: number | null
  name: string
  price: number | null
  cost_price: number | null
  is_hidden: boolean
  is_deleted: boolean
}

export type UbiregiCategory = {
  id: number
  account_id: number
  name: string
  parent_id: number | null
}

// 日別売上ビュー
export type DailySales = {
  account_id: number
  sale_date: string
  checkout_count: number
  subtotal: number
  tax_amount: number
  total: number
  discount_amount: number
  avg_checkout_value: number
}

// 商品別売上ランキングビュー
export type ItemSalesRanking = {
  account_id: number
  menu_item_id: number | null
  menu_item_name: string
  category_id: number | null
  category_name: string | null
  checkout_count: number
  total_quantity: number
  total_revenue: number
  avg_unit_price: number
  total_cost: number | null
  cost_rate_pct: number | null
}
