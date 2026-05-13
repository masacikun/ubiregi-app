import { createClient } from '@supabase/supabase-js'

// Server Component専用クライアント（service role key でRLS/タイムアウト回避）
// SUPABASE_SERVICE_ROLE_KEY はNEXT_PUBLIC_不要 = サーバー側のみで利用可能
export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
