/**
 * sw-custom.js
 *
 * vite-plugin-pwa の additionalManifestEntries や importScripts では
 * なく、workbox の importScripts で読み込む追加SWコード。
 *
 * ★ 使い方：
 *    vite.config.js の workbox.importScripts に '/sw-custom.js' を追加するか、
 *    または public/sw-custom.js として配置し、
 *    workbox の injectManifest モードで使う。
 *
 *    GenerateSW モードでは workbox.additionalManifestEntries を使うか、
 *    このファイルの内容を workbox の runtimeCaching + plugins で記述します。
 *
 * ★ このファイルは public/ フォルダに置いてください。
 *    Service Worker 本体（sw.js）から importScripts で読み込みます。
 *    ただし GenerateSW モードでは SW本体に直接書けないので、
 *    以下のコードをコピーしてvite.config.jsの workbox.additionalManifestEntries
 *    に追記するか、SW登録後に postMessage で制御します。
 *
 * ============================================================
 * ★ 実際に動作させるには：
 *    このファイルの内容を参考に、vite.config.js の
 *    workbox セクションに設定として追記してください（コメント付きで提供）
 * ============================================================
 */

// ── プッシュ通知受信（バックグラウンド）──
self.addEventListener('push', (event) => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title || 'NaMaMeMo', {
      body:  data.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   data.tag   || 'namamemo',
      data:  data.data  || {},
      vibrate: [100, 50, 100],
    })
  )
})

// ── 通知クリック処理 ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const nodeId = event.notification.data?.nodeId
  const url = nodeId
    ? `${self.location.origin}${self.location.pathname.replace('sw.js', '')}?node=${nodeId}`
    : self.location.origin

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // すでに開いているウィンドウがあればそこにフォーカス
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus()
          client.postMessage({ type: 'NAVIGATE_TO_NODE', nodeId })
          return
        }
      }
      // なければ新しいウィンドウを開く
      return clients.openWindow(url)
    })
  )
})

// ── アプリからの通知表示リクエスト ──
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, data } = event.data
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `reminder-${data?.nodeId || Date.now()}`,
        data: data || {},
        vibrate: [200, 100, 200],
      })
    )
  }

  // バージョン情報を返す
  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({
      type: 'VERSION_INFO',
      current: self.__VERSION__ || 'unknown',
      next: self.__NEXT_VERSION__ || 'unknown',
    })
  }

  // Skip Waiting
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// ── シェアターゲット処理 ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.searchParams.has('share-target') && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request))
  }
})

async function handleShareTarget(request) {
  const formData = await request.formData()
  const title    = formData.get('title') || ''
  const text     = formData.get('text')  || ''
  const shareUrl = formData.get('url')   || ''
  const images   = formData.getAll('images')
  const audio    = formData.getAll('audio')
  const files    = formData.getAll('files')

  // 受け取ったデータをIndexedDBに一時保存
  // アプリ側で読み取る
  const db = await openShareDB()
  const tx = db.transaction('shares', 'readwrite')
  tx.objectStore('shares').put({
    id: Date.now(),
    title, text, shareUrl,
    imageNames: images.map(f => f.name),
    audioNames: audio.map(f => f.name),
    fileNames:  files.map(f => f.name),
    createdAt:  Date.now(),
  })

  // ファイルはそれぞれキャッシュに保存
  const cache = await caches.open('share-files-cache')
  for (const file of [...images, ...audio, ...files]) {
    const fileUrl = `share-file://${file.name}`
    cache.put(fileUrl, new Response(file, { headers: { 'Content-Type': file.type } }))
  }

  // アプリを開く（または既存ウィンドウにフォーカス）
  const appUrl = self.registration.scope + '?from-share=1'
  const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clientList.length > 0) {
    clientList[0].focus()
    clientList[0].postMessage({ type: 'SHARE_RECEIVED', title, text, shareUrl })
    return Response.redirect(self.registration.scope, 303)
  }
  return Response.redirect(appUrl, 303)
}

function openShareDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('namamemo_shares', 1)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('shares')) {
        db.createObjectStore('shares', { keyPath: 'id' })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}
