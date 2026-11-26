// アカウント削除: 呼び出したユーザー本人のデータをすべて削除し、最後に Auth ユーザーを削除する。
// コメントテーブルは RLS で直接アクセス禁止のため、データ削除はこの関数（サービスロール）で一括して行う。
// 途中で失敗した場合はエラーを返し、クライアントは再試行できる（各削除は冪等）。
// Google Drive 側の添付ファイル削除はクライアント側で行う（ユーザーの Google トークンが必要なため）。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No authorization header' }, 401)

    // ユーザー認証（呼び出し本人の特定）
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const uid = user.id

    // 本人のデータを削除（コメントは所有ページ分を owner_id で特定）
    const steps: Array<[string, PromiseLike<{ error: unknown }>]> = [
      ['comments', admin.from('comments').delete().eq('owner_id', uid)],
      ['node_backups', admin.from('node_backups').delete().eq('user_id', uid)],
      ['categories', admin.from('categories').delete().eq('user_id', uid)],
      ['nodes', admin.from('nodes').delete().eq('user_id', uid)],
    ]
    for (const [name, query] of steps) {
      const { error } = await query
      if (error) return json({ error: `Failed to delete ${name}`, detail: String(error) }, 500)
    }

    // 最後に Auth ユーザー自体を削除
    const { error: deleteError } = await admin.auth.admin.deleteUser(uid)
    if (deleteError) return json({ error: 'Failed to delete auth user', detail: String(deleteError) }, 500)

    return json({ ok: true })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
