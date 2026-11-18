import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { MAX_LOGIN_COUNT, MAX_DB_MB, MAX_STORAGE_MB } from '../hooks/useSettings'
import { useDialog } from './DialogProvider'
import { scanDriveOrphans, deleteDriveFile, getDriveTokenWithTimeout } from '../utils/driveOrphans'

// 管理者判定：環境変数で管理者メールを設定
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

export function isAdmin(email) {
  return ADMIN_EMAILS.length > 0 && ADMIN_EMAILS.includes(email)
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ja-JP')
}

function fmtMB(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fileIcon(mimeType) {
  if (mimeType?.startsWith('image/')) return '🖼'
  if (mimeType?.startsWith('audio/')) return '🎵'
  if (mimeType?.startsWith('video/')) return '🎬'
  if (mimeType === 'application/pdf') return '📑'
  return '📄'
}

export default function AdminModal({ onClose, currentUserId, onRunDiagnostics, settings }) {
  const { confirm, toast, banner } = useDialog()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [totalLoginCount, setTotalLoginCount] = useState(0)

  // 添付ファイルの掃除（自分の Google Drive が対象）
  const [scanStatus, setScanStatus] = useState('idle') // idle | scanning | done | error
  const [orphans, setOrphans] = useState([])
  const [orphanTotalFiles, setOrphanTotalFiles] = useState(0)
  const [selectedOrphans, setSelectedOrphans] = useState(new Set())
  const [deletingOrphans, setDeletingOrphans] = useState(false)
  const scanTokenRef = useRef(null)

  const handleScanOrphans = async () => {
    setScanStatus('scanning')
    setOrphans([])
    setSelectedOrphans(new Set())
    try {
      const token = await getDriveTokenWithTimeout(settings, 20000)
      if (!token) {
        setScanStatus('error')
        banner('Google Driveと連携できていないため、探せませんでした。Drive連携の状態を確認してください。')
        return
      }
      scanTokenRef.current = token
      const result = await scanDriveOrphans(currentUserId, token)
      setOrphans(result.orphans)
      setOrphanTotalFiles(result.totalFiles)
      // バックアップの中にだけ残っているものは、最初は選択から外す
      setSelectedOrphans(new Set(result.orphans.filter(o => !o.inBackupOnly).map(o => o.id)))
      setScanStatus('done')
    } catch (e) {
      setScanStatus('error')
      banner('探している途中でエラーが発生しました: ' + e.message)
    }
  }

  const toggleOrphan = (id) => {
    setSelectedOrphans(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectedOrphanFiles = orphans.filter(o => selectedOrphans.has(o.id))
  const selectedOrphanBytes = selectedOrphanFiles.reduce((sum, o) => sum + (o.size || 0), 0)
  const backupOnlyCount = orphans.filter(o => o.inBackupOnly).length

  const handleDeleteOrphans = async () => {
    const targets = selectedOrphanFiles
    if (targets.length === 0 || deletingOrphans) return
    if (!await confirm(`選択した ${targets.length} 件のファイル（合計 ${fmtMB(selectedOrphanBytes)}）を Google Drive から完全に削除します。\nこの操作は元に戻せません。よろしいですか？`)) return
    setDeletingOrphans(true)
    try {
      let token = scanTokenRef.current
      if (!token) token = await getDriveTokenWithTimeout(settings, 20000)
      if (!token) {
        banner('Google Driveと連携できていないため、削除できませんでした。')
        return
      }
      scanTokenRef.current = token
      const failed = []
      let okCount = 0
      for (const f of targets) {
        try {
          if (await deleteDriveFile(token, f.id)) okCount++
          else failed.push(f)
        } catch { failed.push(f) }
      }
      setOrphans(failed)
      setSelectedOrphans(new Set())
      if (failed.length === 0) toast(`${okCount} 件のファイルを削除しました`)
      else banner(`${okCount} 件を削除しましたが、${failed.length} 件は削除できませんでした`)
    } finally {
      setDeletingOrphans(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      // RPC経由で全ユーザーのサマリーを取得（RLSバイパス）
      const { data: summaryData, error: summaryErr } = await supabase.rpc('get_all_users_summary')

      let userList
      if (!summaryErr && Array.isArray(summaryData) && summaryData.length > 0) {
        userList = summaryData.map(u => ({
          id: u.user_id,
          nickname: u.nickname || '',
          categories: u.category_names || [],
          nodeCount: u.node_count || 0,
          dbBytes: u.db_bytes || 0,
          storageBytes: null,
          // 登録日・最終ログイン日（集計側が返すようになったら表示される）
          registeredAt: u.registered_at ?? u.created_at ?? null,
          lastLoginAt: u.last_sign_in_at ?? u.last_login_at ?? null,
        }))
      } else {
        // RPC未設定の場合は自分のデータのみ（フォールバック）
        const { data: nodeData } = await supabase.from('nodes').select('user_id, content, title')
        const { data: catData }  = await supabase.from('categories').select('user_id, name')
        const userMap = {}
        ;(catData || []).forEach(c => {
          if (!userMap[c.user_id]) userMap[c.user_id] = { id: c.user_id, categories: [], nodeCount: 0, dbBytes: 0, storageBytes: null }
          userMap[c.user_id].categories.push(c.name)
        })
        ;(nodeData || []).forEach(n => {
          if (!userMap[n.user_id]) userMap[n.user_id] = { id: n.user_id, categories: [], nodeCount: 0, dbBytes: 0, storageBytes: null }
          userMap[n.user_id].nodeCount++
          userMap[n.user_id].dbBytes += (n.content?.length || 0) + (n.title?.length || 0)
        })
        userList = Object.values(userMap)
      }

      // ユーザー数（RPC優先）
      try {
        const { data: rpcCount, error: rpcErr } = await supabase.rpc('get_user_count')
        setTotalLoginCount(!rpcErr && typeof rpcCount === 'number' ? rpcCount : userList.length)
      } catch {
        setTotalLoginCount(userList.length)
      }

      setUsers(userList)
      setLoading(false)

      // ストレージ使用量を各ユーザーごとに取得
      const updatedUsers = await Promise.all(userList.map(async (user) => {
        try {
          const { data: files } = await supabase.storage.from('images').list(user.id)
          if (files) {
            const totalBytes = files.reduce((sum, f) => sum + (f.metadata?.size || 0), 0)
            return { ...user, storageBytes: totalBytes }
          }
        } catch {}
        return { ...user, storageBytes: 0 }
      }))
      setUsers(updatedUsers)
    }
    load()
  }, [])

  const handleDeleteUser = async (userId) => {
    if (userId === currentUserId) {
      toast('自分自身は削除できません')
      return
    }
    if (!await confirm(`このユーザーの全データを削除しますか？\n（ノード・カテゴリ・バックアップ全て）`)) return
    setDeleting(userId)
    try {
      await supabase.from('node_backups').delete().eq('user_id', userId)
      await supabase.from('nodes').delete().eq('user_id', userId)
      await supabase.from('categories').delete().eq('user_id', userId)
      setUsers(prev => prev.filter(u => u.id !== userId))
      setTotalLoginCount(prev => prev - 1)
    } catch (e) {
      banner('削除中にエラーが発生しました: ' + e.message)
    }
    setDeleting(null)
  }

  const dbUsagePct = (bytes) => Math.min(100, (bytes / (MAX_DB_MB * 1024 * 1024)) * 100)
  const storageUsagePct = (bytes) => bytes == null ? 0 : Math.min(100, (bytes / (MAX_STORAGE_MB * 1024 * 1024)) * 100)

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>🔧 管理者パネル</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onRunDiagnostics && (
              <button
                style={{ padding: '4px 12px', background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                onClick={() => { onRunDiagnostics(); onClose() }}
                title="Drive連携の状態を診断して、現在開いているメモに結果を書き出します"
              >
                🔍 Drive診断
              </button>
            )}
            <button style={styles.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ログイン人数 */}
        <div style={styles.countBar}>
          <span style={styles.countLabel}>現在のユーザー数</span>
          <span style={styles.countValue}>
            {loading ? '…' : `${totalLoginCount} / ${MAX_LOGIN_COUNT}`}
          </span>
          <div style={styles.countBarBg}>
            <div style={{
              ...styles.countBarFill,
              width: `${Math.min(100, (totalLoginCount / MAX_LOGIN_COUNT) * 100)}%`,
              background: totalLoginCount / MAX_LOGIN_COUNT > 0.8 ? '#e53e3e' : 'var(--accent)',
            }} />
          </div>
        </div>

        {/* 添付ファイルの掃除（自分の Google Drive） */}
        <div style={styles.orphanSection}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>🧹 添付ファイルの掃除（自分の Google Drive）</span>
            <button
              style={styles.scanBtn}
              onClick={handleScanOrphans}
              disabled={scanStatus === 'scanning' || deletingOrphans}
            >
              {scanStatus === 'scanning' ? '探しています…' : '残っているファイルを探す'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            メモから消えたのに Google Drive に残っている添付ファイル（画像・音声・動画・PDF）を探します。探すだけでは何も変わりません。
          </p>
          {scanStatus === 'done' && (
            orphans.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                残っているファイルはありませんでした（Drive 内のファイル全 {orphanTotalFiles} 件を確認しました）。
              </p>
            ) : (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                  <strong>{orphans.length} 件</strong>のファイルが残っています（合計 {fmtMB(orphans.reduce((s, o) => s + (o.size || 0), 0))}）。Drive 内のファイル全 {orphanTotalFiles} 件を確認しました。
                </p>
                {backupOnlyCount > 0 && (
                  <p style={{ fontSize: 11, color: '#b45309', marginTop: 4, lineHeight: 1.5 }}>
                    うち {backupOnlyCount} 件はバックアップの中にだけ残っているファイルです。バックアップを復元したときに必要になるため、最初は選択から外しています。
                  </p>
                )}
                <div style={styles.orphanList}>
                  {orphans.map(o => (
                    <label key={o.id} style={styles.orphanRow}>
                      <input
                        type="checkbox"
                        checked={selectedOrphans.has(o.id)}
                        onChange={() => toggleOrphan(o.id)}
                        disabled={deletingOrphans}
                        style={{ width: 15, height: 15, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 15, flexShrink: 0 }}>{fileIcon(o.mimeType)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>
                          {o.size == null ? 'サイズ不明' : fmtMB(o.size)} / {fmtDate(o.createdTime)}
                          {o.inBackupOnly && <span style={{ color: '#b45309' }}> / バックアップ内にのみ残っています</span>}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button
                    style={styles.orphanSubBtn}
                    onClick={() => setSelectedOrphans(new Set(orphans.filter(o => !o.inBackupOnly).map(o => o.id)))}
                    disabled={deletingOrphans}
                  >
                    全て選択（バックアップ分は除く）
                  </button>
                  <button
                    style={styles.orphanSubBtn}
                    onClick={() => setSelectedOrphans(new Set())}
                    disabled={deletingOrphans}
                  >
                    選択を解除
                  </button>
                  <button
                    style={{ ...styles.deleteBtn, marginLeft: 'auto' }}
                    onClick={handleDeleteOrphans}
                    disabled={selectedOrphanFiles.length === 0 || deletingOrphans}
                  >
                    {deletingOrphans ? '削除中…' : `選択した ${selectedOrphanFiles.length} 件（${fmtMB(selectedOrphanBytes)}）を削除`}
                  </button>
                </div>
              </div>
            )
          )}
        </div>

        <div style={styles.body}>
          {loading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>読み込み中…</p>
          ) : users.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>ユーザーが見つかりません</p>
          ) : (
            <div style={styles.userList}>
              {users.map(user => {
                const dbPct = dbUsagePct(user.dbBytes)
                const stPct = storageUsagePct(user.storageBytes)
                return (
                  <div key={user.id} style={{
                    ...styles.userRow,
                    background: user.id === currentUserId ? 'var(--accent-bg)' : 'var(--surface)',
                  }}>
                    <div style={styles.userInfo}>
                      <div style={styles.userId}>
                        {user.id === currentUserId && <span style={styles.selfBadge}>自分</span>}
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                          {user.nickname || <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>（未設定）</span>}
                        </span>
                        <span style={styles.userIdText}>{user.id.slice(0, 8)}…</span>
                      </div>
                      <div style={styles.userMeta}>
                        カテゴリ: {user.categories.slice(0, 2).join(', ')}{user.categories.length > 2 ? '…' : ''} / ノード: {user.nodeCount}件
                      </div>
                      <div style={styles.userMeta}>
                        登録: {fmtDate(user.registeredAt)} / 最終ログイン: {fmtDate(user.lastLoginAt)}
                      </div>

                      {/* DB使用量バー */}
                      <div style={{ marginTop: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                          <span>DB使用量</span>
                          <span>{fmtMB(user.dbBytes)} / {MAX_DB_MB} MB ({dbPct.toFixed(1)}%)</span>
                        </div>
                        <div style={styles.usageBarBg}>
                          <div style={{ ...styles.usageBarFill, width: `${dbPct}%`, background: dbPct > 80 ? '#e53e3e' : 'var(--accent)' }} />
                        </div>
                      </div>

                      {/* ストレージ使用量バー */}
                      <div style={{ marginTop: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                          <span>ストレージ</span>
                          <span>
                            {user.storageBytes == null
                              ? '取得中…'
                              : `${fmtMB(user.storageBytes)} / ${MAX_STORAGE_MB} MB (${stPct.toFixed(1)}%)`}
                          </span>
                        </div>
                        <div style={styles.usageBarBg}>
                          <div style={{ ...styles.usageBarFill, width: `${stPct}%`, background: stPct > 80 ? '#e53e3e' : '#38a169' }} />
                        </div>
                      </div>
                    </div>
                    <button
                      style={{
                        ...styles.deleteBtn,
                        opacity: user.id === currentUserId ? 0.3 : 1,
                        cursor: user.id === currentUserId ? 'default' : 'pointer',
                      }}
                      disabled={user.id === currentUserId || deleting === user.id}
                      onClick={() => handleDeleteUser(user.id)}
                    >
                      {deleting === user.id ? '削除中…' : '🗑 削除'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div style={styles.footer}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>⚠ Supabase Auth のユーザー削除は管理ダッシュボードから行ってください</p>
          <button style={styles.closeFooterBtn} onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--bg)', borderRadius: 16, width: 560, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 12px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 17, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--text-muted)', width: 28, height: 28, borderRadius: 6 },
  countBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 },
  countLabel: { fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 },
  countValue: { fontSize: 16, fontWeight: 700, color: 'var(--text)', flexShrink: 0 },
  countBarBg: { flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' },
  countBarFill: { height: '100%', borderRadius: 3, transition: 'width 0.5s' },
  body: { flex: 1, overflowY: 'auto', padding: 20 },
  userList: { display: 'flex', flexDirection: 'column', gap: 10 },
  userRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' },
  userInfo: { flex: 1, minWidth: 0 },
  userId: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 },
  selfBadge: { fontSize: 10, background: 'var(--accent)', color: 'white', padding: '1px 6px', borderRadius: 10, fontWeight: 700, flexShrink: 0 },
  userIdText: { fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' },
  userMeta: { fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  usageBarBg: { height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' },
  usageBarFill: { height: '100%', borderRadius: 2, transition: 'width 0.5s' },
  deleteBtn: { padding: '5px 12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, color: '#dc2626', fontWeight: 600, flexShrink: 0 },
  orphanSection: { padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  scanBtn: { padding: '4px 12px', background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 600, flexShrink: 0 },
  orphanList: { marginTop: 8, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 },
  orphanRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' },
  orphanSubBtn: { padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, cursor: 'pointer', color: 'var(--text)' },
  footer: { padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  closeFooterBtn: { padding: '7px 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text)' },
}
