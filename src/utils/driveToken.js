/**
 * driveToken.js
 *
 * Google Drive アクセストークンを自動更新するユーティリティ。
 *
 * 優先順位:
 *   1. キャッシュ（55分間有効）
 *   2. Supabase Edge Function "refresh-drive-token"（完全自動・サーバーサイド）
 *   3. フォールバック: GIS stored token
 *   4. 最終手段: ユーザーに再連携バナーを表示
 */
import { supabase } from '../supabaseClient'

// モジュールレベルキャッシュ（ページリロードまで保持）
let _cachedToken = null
let _cacheExpiry = 0

/**
 * 有効な Drive アクセストークンを返す。
 *
 * @param {object} settings - useSettings() から得られる設定オブジェクト
 * @returns {Promise<string|null>}
 */
export async function getValidDriveToken(settings) {
  // オフライン中はキャッシュを返す（なければ null）
  // 再接続バナーは出さない（オフラインなのに「Drive切断」扱いにしない）
  if (!navigator.onLine) {
    return _cachedToken || null
  }

  // 1. キャッシュが有効なら即返す（55分キャッシュ、余裕を持って5分前に破棄）
  if (_cachedToken && Date.now() < _cacheExpiry) {
    return _cachedToken
  }

  // 2. Edge Function でサーバーサイド自動更新を試みる
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      // settings に保存済みの provider_refresh_token があれば Edge Function に渡す
      // （Supabase DB のクエリが失敗した場合のフォールバックとして使用）
      const body = settings.googleProviderRefreshToken
        ? JSON.stringify({ hint_refresh_token: settings.googleProviderRefreshToken })
        : '{}'

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-drive-token`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body,
        }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.access_token) {
          _cachedToken = data.access_token
          // expires_in は秒。5分の余裕を持ってキャッシュ期限を設定（最大55分）
          const ttl = Math.min((data.expires_in - 300) * 1000, 55 * 60 * 1000)
          _cacheExpiry = Date.now() + (ttl > 0 ? ttl : 50 * 60 * 1000)
          return _cachedToken
        }
      } else {
        const errData = await res.json().catch(() => ({}))
        // no_refresh_token: 再ログインが必要（ユーザーに通知する経路へ）
        if (errData.error === 'no_refresh_token') {
          console.warn('[DriveToken] provider_refresh_tokenなし。再ログインが必要です。')
          // フォールバック処理へ進む
        } else {
          console.warn('[DriveToken] Edge Function エラー:', errData)
        }
      }
    }
  } catch (e) {
    console.warn('[DriveToken] Edge Function 呼び出し失敗:', e)
  }

  // 3. GIS stored token（Edge Function が失敗した場合のフォールバック）
  if (settings.googleDriveToken) {
    const expiry = settings.googleDriveTokenExpiry || 0
    if (expiry > Date.now() + 60 * 1000) {
      // まだ有効なら使う
      return settings.googleDriveToken
    }
  }

  // 4. 最終手段: ユーザーに再連携バナーを表示
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent('refresh-drive-token', { detail: { callback: resolve } }))
  })
}

/**
 * キャッシュを強制クリア（ログアウト時などに呼ぶ）
 */
export function clearDriveTokenCache() {
  _cachedToken = null
  _cacheExpiry = 0
}
