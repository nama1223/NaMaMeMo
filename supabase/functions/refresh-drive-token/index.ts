import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    // ユーザー認証
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // クライアントから渡された hint_refresh_token を受け取る
    // （Supabase DB に保存されていない場合のフォールバック）
    let hintRefreshToken: string | null = null
    try {
      const body = await req.json()
      hintRefreshToken = body.hint_refresh_token ?? null
    } catch { /* body なし or JSON でない場合は無視 */ }

    // auth スキーマを直接クエリして provider_refresh_token を取得
    // （Admin API の getUserById は identity_data の OAuth トークンを公開しないため）
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 方法1: auth.identities テーブルを直接クエリ
    let providerRefreshToken: string | null = null

    const { data: identityRow, error: identityErr } = await adminClient
      .schema('auth')
      .from('identities')
      .select('identity_data')
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .single()

    if (!identityErr && identityRow?.identity_data) {
      providerRefreshToken = identityRow.identity_data.provider_refresh_token ?? null
    }

    // 方法2: フォールバック — getUserById 経由
    if (!providerRefreshToken) {
      const { data: { user: adminUser } } = await adminClient.auth.admin.getUserById(user.id)
      const googleIdentity = adminUser?.identities?.find((i: any) => i.provider === 'google')
      providerRefreshToken = googleIdentity?.identity_data?.provider_refresh_token ?? null
    }

    // 方法3: クライアントが保存していた hint_refresh_token を使う
    if (!providerRefreshToken && hintRefreshToken) {
      console.log('[refresh-drive-token] DB にトークンなし → クライアント提供の hint を使用')
      providerRefreshToken = hintRefreshToken
    }

    console.log('[refresh-drive-token] user:', user.id, '/ refresh_token found:', !!providerRefreshToken, '/ source:', providerRefreshToken === hintRefreshToken ? 'client-hint' : 'db')

    if (!providerRefreshToken) {
      return new Response(
        JSON.stringify({
          error: 'no_refresh_token',
          message: 'Google の provider_refresh_token が見つかりません。一度ログアウトして、Google 認証画面で「アクセスを許可」を再度実行してください。',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Google トークンエンドポイントで新しい access_token を取得
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: providerRefreshToken,
        grant_type:    'refresh_token',
      }),
    })

    const tokenData = await tokenRes.json()
    if (tokenData.error) {
      console.error('[refresh-drive-token] Google token error:', tokenData)
      return new Response(
        JSON.stringify({ error: tokenData.error, error_description: tokenData.error_description }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        access_token: tokenData.access_token,
        expires_in:   tokenData.expires_in ?? 3600,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    console.error('[refresh-drive-token] Error:', e)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
