/**
 * InstallBanner.jsx
 *
 * 「ホーム画面に追加」を促すバナー。
 * beforeinstallprompt イベントが発火したときのみ表示。
 */
import { useState } from 'react'

export default function InstallBanner({ onInstall, onDismiss }) {
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    setInstalling(true)
    await onInstall()
    setInstalling(false)
  }

  return (
    <div style={styles.banner}>
      <span style={styles.icon}>📱</span>
      <div style={styles.text}>
        <span style={styles.title}>ホーム画面に追加できます</span>
        <span style={styles.desc}>オフラインでも使える便利なアプリとしてインストール</span>
      </div>
      <button
        style={styles.installBtn}
        onClick={handleInstall}
        disabled={installing}
      >
        {installing ? '…' : 'インストール'}
      </button>
      <button style={styles.dismissBtn} onClick={onDismiss} title="閉じる">✕</button>
    </div>
  )
}

const styles = {
  banner: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0, zIndex: 9,
  },
  icon: { fontSize: 20, flexShrink: 0 },
  text: { flex: 1, display: 'flex', flexDirection: 'column', gap: 1 },
  title: { fontSize: 12, fontWeight: 700, color: 'var(--text)' },
  desc: { fontSize: 11, color: 'var(--text-muted)' },
  installBtn: {
    padding: '5px 14px',
    background: 'var(--accent)', color: 'white',
    border: 'none', borderRadius: 8,
    fontSize: 12, cursor: 'pointer', fontWeight: 700,
    flexShrink: 0,
  },
  dismissBtn: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer', fontSize: 14, flexShrink: 0,
    padding: '4px',
  },
}
