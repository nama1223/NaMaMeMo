/**
 * usePWA.js
 *
 * PWA全般を管理するカスタムフック
 * - Service Worker更新検知（バージョンモーダル表示）
 * - オフライン/オンライン状態管理
 * - オフライン書き込みキューの送信
 * - インストールプロンプト（A2HS）
 */
import { useState, useEffect, useCallback, useRef } from 'react'

// workbox-window は vite-plugin-pwa が自動インジェクトするので
// ここでは window.__pwaRegistration 経由で受け取る
// （main.jsx で登録したものを window に保存する）

export function usePWA() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false)
  const [swVersions, setSwVersions] = useState({ current: null, next: null })
  const [offlineQueueCount, setOfflineQueueCount] = useState(0)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)

  const waitingSwRef = useRef(null)

  // ── オンライン/オフライン検知 ──
  useEffect(() => {
    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // ── A2HS（ホーム画面追加）プロンプト ──
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // すでにインストール済みかどうか
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // ── SW更新検知 ──
  // main.jsx が window.__wb（workbox-window インスタンス）を設定してくれる
  useEffect(() => {
    const wb = window.__wb
    if (!wb) return

    // SW更新があった時
    const onWaiting = (event) => {
      waitingSwRef.current = event.sw || null
      // バージョン情報をSWから取得（postMessage）
      // SWは自身のバージョンをメッセージで返す
      navigator.serviceWorker.ready.then(reg => {
        const currentSw = reg.active
        // 現在のバージョンを取得
        currentSw?.postMessage({ type: 'GET_VERSION' })
      })
      // 少し待ってからモーダル表示（バージョン取得のため）
      setTimeout(() => setSwUpdateAvailable(true), 300)
    }

    wb.addEventListener('waiting', onWaiting)
    wb.addEventListener('externalwaiting', onWaiting)

    return () => {
      wb.removeEventListener('waiting', onWaiting)
      wb.removeEventListener('externalwaiting', onWaiting)
    }
  }, [])

  // ── SWからのメッセージ受信（バージョン情報など）──
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'VERSION_INFO') {
        setSwVersions(prev => ({
          ...prev,
          current: event.data.current,
          next: event.data.next,
        }))
      }
      if (event.data?.type === 'OFFLINE_QUEUE_COUNT') {
        setOfflineQueueCount(event.data.count)
      }
      if (event.data?.type === 'SYNC_COMPLETE') {
        setOfflineQueueCount(0)
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [])

  // ── SW更新を適用（スキップウェイティング） ──
  const applyUpdate = useCallback(() => {
    const wb = window.__wb
    if (wb) {
      wb.messageSkipWaiting()
    } else if (waitingSwRef.current) {
      waitingSwRef.current.postMessage({ type: 'SKIP_WAITING' })
    }
    setSwUpdateAvailable(false)
    // ユーザーが「今すぐ更新」を押した場合のみリロード
    // （controlling イベントでの自動リロードは無限ループを引き起こすため使用しない）
    setTimeout(() => window.location.reload(), 300)
  }, [])

  const dismissUpdate = useCallback(() => {
    setSwUpdateAvailable(false)
  }, [])

  // ── インストール実行 ──
  const promptInstall = useCallback(async () => {
    if (!installPrompt) return false
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
      setIsInstalled(true)
      setInstallPrompt(null)
    }
    return outcome === 'accepted'
  }, [installPrompt])

  return {
    isOnline,
    swUpdateAvailable,
    swVersions,
    offlineQueueCount,
    installPrompt: !!installPrompt && !isInstalled,
    isInstalled,
    applyUpdate,
    dismissUpdate,
    promptInstall,
  }
}
