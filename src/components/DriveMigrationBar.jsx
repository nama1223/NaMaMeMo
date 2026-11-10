/**
 * DriveMigrationBar.jsx
 *
 * Drive移設の進捗を画面下部に表示するバー。
 * - 進捗バー（完了/全体）
 * - 現在処理中のファイル名
 * - 開始・中断・再試行ボタン
 * - 折りたたみ可能
 */
import { useState } from 'react'

export default function DriveMigrationBar({
  running, current, stats, hasWork, pendingCount,
  onStart, onStop, onRetry, onClear,
}) {
  const [collapsed, setCollapsed] = useState(false)

  if (!hasWork && stats.done === 0) return null

  const { total, done, failed } = stats
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const allDone = total > 0 && done === total && failed === 0

  return (
    <div style={S.bar}>
      {/* ヘッダー行 */}
      <div style={S.header} onClick={() => setCollapsed(v => !v)}>
        <span style={S.title}>
          {running ? '🔄' : allDone ? '✅' : failed > 0 ? '⚠️' : '📦'}
          {' '}Drive移設
          {running && current && <span style={S.currentFile}>「{current.filename || current.nodeType}」を処理中…</span>}
          {allDone && <span style={{ color: '#38a169', fontSize: 12 }}> 完了！</span>}
        </span>
        <div style={S.headerRight}>
          <span style={S.counter}>{done}/{total}</span>
          <button style={S.collapseBtn}>{collapsed ? '▲' : '▼'}</button>
        </div>
      </div>

      {/* プログレスバー */}
      <div style={S.progressTrack}>
        <div style={{ ...S.progressFill, width: `${pct}%`, background: allDone ? '#38a169' : failed > 0 ? '#e53e3e' : 'var(--accent)' }} />
        {failed > 0 && (
          <div style={{ ...S.progressFill, width: `${Math.round((failed/total)*100)}%`, background: '#fc8181', marginLeft: `${pct}%`, position: 'absolute', top: 0, left: 0 }} />
        )}
      </div>

      {/* 詳細（折りたたみ）*/}
      {!collapsed && (
        <div style={S.detail}>
          <div style={S.stats}>
            <span style={{ color: '#38a169' }}>✓ 完了 {done}</span>
            {failed > 0 && <span style={{ color: '#e53e3e' }}>✗ 失敗 {failed}</span>}
            {pendingCount > 0 && <span style={{ color: 'var(--text-muted)' }}>⏳ 残り {pendingCount}</span>}
          </div>
          <div style={S.buttons}>
            {!running && pendingCount > 0 && (
              <button style={{ ...S.btn, background: 'var(--accent)', color: 'white' }} onClick={onStart}>
                ▶ {done > 0 ? '再開' : '開始'}
              </button>
            )}
            {running && (
              <button style={{ ...S.btn, background: '#e53e3e', color: 'white' }} onClick={onStop}>
                ⏸ 中断
              </button>
            )}
            {!running && failed > 0 && (
              <button style={{ ...S.btn, background: '#dd6b20', color: 'white' }} onClick={onRetry}>
                🔁 失敗を再試行
              </button>
            )}
            {!running && allDone && (
              <button style={{ ...S.btn, background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }} onClick={onClear}>
                ✕ 閉じる
              </button>
            )}
          </div>
          {!running && pendingCount > 0 && (
            <p style={S.note}>
              ※ Google Drive連携が必要です。移設中もアプリは使えます。<br/>
              中断・再起動後も続きから再開できます。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const S = {
  bar: {
    flexShrink: 0,
    background: 'var(--surface)',
    borderTop: '2px solid var(--accent)',
    boxShadow: '0 -2px 8px rgba(0,0,0,0.1)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 14px 4px', cursor: 'pointer', userSelect: 'none',
  },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, flex: 1 },
  currentFile: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  counter: { fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' },
  collapseBtn: { background: 'none', border: 'none', fontSize: 10, cursor: 'pointer', color: 'var(--text-muted)', padding: 2 },
  progressTrack: { position: 'relative', height: 4, background: 'var(--border)', margin: '0 0 0 0' },
  progressFill: { height: '100%', transition: 'width 0.4s ease', borderRadius: 0 },
  detail: { padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 8 },
  stats: { display: 'flex', gap: 14, fontSize: 12, fontWeight: 600 },
  buttons: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  btn: {
    padding: '6px 14px', border: 'none', borderRadius: 8,
    fontSize: 12, cursor: 'pointer', fontWeight: 700,
  },
  note: { fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 },
}
