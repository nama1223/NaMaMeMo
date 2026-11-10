/**
 * OfflineBanner.jsx
 *
 * オフライン中に上部に表示するバナー。
 * 同期中・同期完了のトーストも兼ねる。
 */
import { useState, useEffect } from 'react'

export default function OfflineBanner({ isOnline, queueCount, syncing, lastSyncAt }) {
  const [showSyncToast, setShowSyncToast] = useState(false)
  const [prevOnline, setPrevOnline] = useState(isOnline)

  // オンラインに戻った瞬間にトーストを表示
  useEffect(() => {
    if (!prevOnline && isOnline && queueCount > 0) {
      setShowSyncToast(true)
    }
    setPrevOnline(isOnline)
  }, [isOnline])

  // 同期完了でトーストを消す（少し残す）
  useEffect(() => {
    if (lastSyncAt && !syncing) {
      const timer = setTimeout(() => setShowSyncToast(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [lastSyncAt, syncing])

  if (isOnline && !showSyncToast) return null

  return (
    <>
      {/* オフラインバナー */}
      {!isOnline && (
        <div style={styles.offlineBanner}>
          <span style={styles.wifiIcon}>📴</span>
          <div style={styles.offlineText}>
            <span style={styles.offlineTitle}>オフラインモード</span>
            <span style={styles.offlineDesc}>
              {queueCount > 0
                ? `${queueCount}件の変更を保存中。オンライン復帰時に自動送信されます。`
                : '変更はオンライン復帰時に自動で同期されます。'}
            </span>
          </div>
          <div style={styles.pulseDot} />
        </div>
      )}

      {/* 同期中・同期完了トースト */}
      {isOnline && showSyncToast && (
        <div style={{ ...styles.syncToast, ...(syncing ? {} : styles.syncDone) }}>
          {syncing ? (
            <>
              <span style={styles.spinner}>⟳</span>
              <span>オフライン中の変更を同期しています…</span>
            </>
          ) : (
            <>
              <span>✅</span>
              <span>同期が完了しました！すべての変更がサーバーに保存されました。</span>
            </>
          )}
        </div>
      )}
    </>
  )
}

const styles = {
  offlineBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    flexShrink: 0,
    background: 'linear-gradient(135deg, #374151, #1f2937)',
    color: 'white',
    fontSize: 12,
    zIndex: 9,
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  },
  wifiIcon: { fontSize: 16, flexShrink: 0 },
  offlineText: {
    display: 'flex', flexDirection: 'column', gap: 1, flex: 1,
  },
  offlineTitle: { fontWeight: 700, fontSize: 12 },
  offlineDesc: { fontSize: 11, opacity: 0.8 },
  pulseDot: {
    width: 8, height: 8,
    borderRadius: '50%',
    background: '#f59e0b',
    flexShrink: 0,
    animation: 'pulse 1.5s ease-in-out infinite',
    boxShadow: '0 0 0 0 rgba(245,158,11,0.4)',
  },
  syncToast: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    flexShrink: 0,
    background: '#1d4ed8',
    color: 'white',
    fontSize: 12,
    fontWeight: 500,
    zIndex: 9,
  },
  syncDone: {
    background: '#065f46',
  },
  spinner: {
    fontSize: 14,
    display: 'inline-block',
    animation: 'spin 0.8s linear infinite',
  },
}
