import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// ── Service Worker 登録（workbox-window経由） ──
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('workbox-window').then(({ Workbox }) => {
    const wb = new Workbox(import.meta.env.BASE_URL + 'sw.js', {
      scope: import.meta.env.BASE_URL,
    })
    // usePWA.js が参照できるようにグローバルに保存
    window.__wb = wb

    // SWからのメッセージ受信
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'NAVIGATE_TO_NODE') {
        window.dispatchEvent(new CustomEvent('namamemo-navigate-node', { detail: event.data }))
      }
    })

    wb.register().catch(err => console.warn('[NaMaMeMo] SW登録失敗:', err))
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
