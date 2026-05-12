import { supabase } from '@/lib/supabase'
import ItemsClient from './ItemsClient'

async function getItemsData() {
  // 商品別売上ランキング（全期間）
  const { data: ranking } = await supabase
    .from('v_item_sales_ranking')
    .select('*')
    .order('total_revenue', { ascending: false })
    .limit(50)

  // カテゴリ別売上
  const { data: categorySales } = await supabase
    .from('v_category_sales')
    .select('*')
    .order('total_revenue', { ascending: false })

  return {
    ranking: ranking ?? [],
    categorySales: categorySales ?? [],
  }
}

export default async function ItemsPage() {
  const data = await getItemsData()
  return <ItemsClient {...data} />
}
