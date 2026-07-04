import 'server-only'
import { createClient } from '@supabase/supabase-js'

// 2026-07-04 サーバ側は内部PostgRESTリスナー(SUPABASE_URL=127.0.0.1:3101)経由。未設定時は公開URLにフォールバック
const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)!

export const supabaseAdmin = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)
