import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

// Vite環境変数が使える場合は使い、無ければハードコード（安全対策）
const BASE = import.meta.env.BASE_URL || '/NaMaMeMo/'

precacheAndRoute(self.__WB_MANIFEST)

// Google Fonts
registerRoute(
  /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
)

// Supabase Storage (画像)
registerRoute(
  ({ url }) => url.hostname.includes('supabase') && url.pathname.includes('/storage/'),
  new CacheFirst({
    cacheName: 'supabase-images',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
)

// ── ★ シェアターゲット (POST) のハンドリング（修正版） ──

registerRoute(
  ({ url }) => url.pathname === BASE + 'share-target',
  async ({ event }) => {
    const formData = await event.request.formData()
    const shareCache = await caches.open('tmp-share-data')
    
    const textData = {}
    const fileKeys = []

    // データをテキストとFileオブジェクトに仕分ける
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        // ファイルは個別のリクエストとしてキャッシュに保存
        const fileUrl = `${BASE}shared-file/${key}/${encodeURIComponent(value.name)}`
        await shareCache.put(
          new Request(fileUrl), 
          new Response(value, {
            headers: {
              'Content-Type': value.type,
              'X-Original-Name': encodeURIComponent(value.name)
            }
          })
        )
        fileKeys.push(fileUrl)
      } else {
        // テキストやURLはオブジェクトにまとめる
        textData[key] = value
      }
    }

    // 保存したファイルのURLリストもテキストデータに混ぜておく
    textData.fileKeys = fileKeys

    // テキストデータをJSONとして保存
    await shareCache.put(
      new Request(`${BASE}shared-post-data`),
      new Response(JSON.stringify(textData), {
        headers: { 'Content-Type': 'application/json' }
      })
    )

    // リダイレクト先もBASEを利用
    return Response.redirect(`${BASE}?shared=1`, 303)
  },
  'POST'
)

// アプリの更新モーダルから「今すぐ更新」が押されたときのみ skipWaiting を呼ぶ
// （install イベントでの自動 skipWaiting は Supabase ロック競合を引き起こすため使わない）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})