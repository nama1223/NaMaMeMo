/**
 * PWAUpdateModal.jsx
 *
 * SWの新バージョンが届いた時に表示するモーダル。
 * 現在のバージョンと新バージョンを並べて表示し、
 * 「更新する」か「後で」を選ばせる。
 */
import { VERSION } from './ChangelogModal'

export default function PWAUpdateModal({ versions, onUpdate, onDismiss }) {
  const currentVersion = versions?.current || VERSION
  const nextVersion    = versions?.next    || '新バージョン'

  return (
    <div style={styles.overlay} onClick={onDismiss}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* アイコン */}
        <div style={styles.iconArea}>
          <span style={styles.icon}>🔄</span>
        </div>

        <h2 style={styles.title}>アップデートがあります</h2>
        <p style={styles.desc}>
          NaMaMeMo の新しいバージョンが届きました。<br />
          更新するとすぐに新機能が使えるようになります。
        </p>

        {/* バージョン表示 */}
        <div style={styles.versionRow}>
          <div style={styles.versionBox}>
            <span style={styles.versionLabel}>現在</span>
            <span style={styles.versionNum}>v{currentVersion}</span>
          </div>
          <span style={styles.arrow}>→</span>
          <div style={{ ...styles.versionBox, ...styles.versionBoxNew }}>
            <span style={styles.versionLabel}>新しいバージョン</span>
            <span style={{ ...styles.versionNum, color: '#5b6af0' }}>v{nextVersion}</span>
          </div>
        </div>

        {/* ボタン */}
        <div style={styles.btnRow}>
          <button style={styles.laterBtn} onClick={onDismiss}>
            後で
          </button>
          <button style={styles.updateBtn} onClick={onUpdate}>
            ✨ 今すぐ更新
          </button>
        </div>

        <p style={styles.note}>
          ※ 更新するとページがリロードされます。<br />
          編集中のメモは自動保存されます。
        </p>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'var(--bg)',
    borderRadius: 20,
    padding: '32px 28px 24px',
    width: 360,
    maxWidth: '90vw',
    boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
    textAlign: 'center',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
  },
  iconArea: {
    width: 64, height: 64,
    background: 'var(--accent-bg)',
    borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  icon: { fontSize: 32 },
  title: {
    fontSize: 20, fontWeight: 700,
    color: 'var(--text)',
    margin: 0,
  },
  desc: {
    fontSize: 13, color: 'var(--text-muted)',
    lineHeight: 1.7, margin: 0,
  },
  versionRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    margin: '4px 0',
  },
  versionBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    padding: '10px 18px',
    background: 'var(--surface)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    minWidth: 100,
  },
  versionBoxNew: {
    border: '2px solid var(--accent)',
    background: 'var(--accent-bg)',
  },
  versionLabel: {
    fontSize: 10, color: 'var(--text-muted)',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  versionNum: {
    fontSize: 18, fontWeight: 700,
    color: 'var(--text)',
    fontVariantNumeric: 'tabular-nums',
  },
  arrow: {
    fontSize: 20, color: 'var(--text-muted)',
    flexShrink: 0,
  },
  btnRow: {
    display: 'flex', gap: 10, width: '100%', marginTop: 4,
  },
  laterBtn: {
    flex: 1, padding: '11px 0',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    fontSize: 14, color: 'var(--text-muted)',
    cursor: 'pointer', fontWeight: 600,
  },
  updateBtn: {
    flex: 2, padding: '11px 0',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 12,
    fontSize: 14, color: 'white',
    cursor: 'pointer', fontWeight: 700,
    boxShadow: '0 4px 14px rgba(91,106,240,0.35)',
  },
  note: {
    fontSize: 11, color: 'var(--text-muted)',
    lineHeight: 1.6, margin: 0,
  },
}
