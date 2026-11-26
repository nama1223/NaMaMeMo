import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getValidDriveToken, clearDriveTokenCache } from '../utils/driveToken'
import { cleanupDriveData } from '../utils/driveCleanup'

// アカウント削除モーダル。「削除」と入力しないと実行できない強い確認にする。
// 削除の順番: Drive添付ファイル → ストレージ画像 → サーバー側データ＋認証（Edge Function）→ 端末内の後片付け。
export default function DeleteAccountModal({ settings, userId, onClose }) {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState('confirm') // confirm | driveWarn | working | error | done
  const [driveWarnMsg, setDriveWarnMsg] = useState('')
  const [logs, setLogs] = useState([])
  const [errorMsg, setErrorMsg] = useState('')

  const canRun = input === '削除' && phase === 'confirm'

  const addLog = (line) => setLogs(prev => [...prev, line])

  async function listStoragePaths(prefix) {
    const out = []
    const { data, error } = await supabase.storage.from('images').list(prefix, { limit: 1000 })
    if (error) throw error
    for (const item of data || []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.metadata) out.push(path)
      else out.push(...await listStoragePaths(path))
    }
    return out
  }

  const runDeletion = async (skipDrive) => {
    setPhase('working')
    setLogs([])
    try {
      // 1. Google Drive の添付ファイルとフォルダ
      if (!skipDrive) {
        addLog('Google Driveの添付ファイルを削除しています…')
        let token = null
        try { token = await getValidDriveToken(settings) } catch { token = null }
        if (!token) {
          setDriveWarnMsg('Google Driveに接続できなかったため、Drive内の添付ファイルとフォルダは削除できません。')
          setPhase('driveWarn')
          return
        }
        try {
          const r = await cleanupDriveData(token)
          if (!r.folderFound) addLog('Drive: NaMaMeMoフォルダは見つかりませんでした')
          else addLog(`Drive: ファイル ${r.filesDeleted} 件とNaMaMeMoフォルダを削除しました${r.studioDeleted ? '（空になったNamaStudioフォルダも削除しました）' : ''}`)
        } catch (e) {
          setDriveWarnMsg('Google Driveの削除中に問題が起きました: ' + (e?.message || e))
          setPhase('driveWarn')
          return
        }
      } else {
        addLog('Drive: ファイルは残して続行します')
      }

      // 2. ストレージ（画像）
      addLog('画像データを削除しています…')
      try {
        const paths = await listStoragePaths(userId)
        if (paths.length > 0) {
          const { error } = await supabase.storage.from('images').remove(paths)
          if (error) throw error
        }
        addLog(`画像: ${paths.length} 件を削除しました`)
      } catch {
        addLog('画像データの一部を削除できませんでした（続行します）')
      }

      // 3. サーバー側のデータと認証アカウント
      addLog('アカウントのデータを削除しています…')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('ログイン情報が確認できませんでした')
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `削除処理に失敗しました (${res.status})`)
      }

      // 4. 端末内の後片付け（このアプリの保存分だけ。他アプリのデータには触らない）
      try {
        const keys = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && k.startsWith('namamemo')) keys.push(k)
        }
        keys.forEach(k => localStorage.removeItem(k))
      } catch {}
      try { indexedDB.deleteDatabase('namamemo_offline_v1') } catch {}
      clearDriveTokenCache()
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      setPhase('done')
    } catch (e) {
      setErrorMsg(e?.message || String(e))
      setPhase('error')
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>アカウントの削除</h2>
          {phase !== 'working' && phase !== 'done' && (
            <button style={styles.closeBtn} onClick={onClose}>✕</button>
          )}
        </div>
        <div style={styles.body}>
          {phase === 'confirm' && (
            <>
              <p style={{ ...styles.p, fontWeight: 700, color: '#c53030' }}>この操作は取り消せません。</p>
              <ul style={styles.ul}>
                <li style={styles.li}>メモ・カテゴリ・バックアップのデータがすべて削除されます</li>
                <li style={styles.li}>公開ページと、そこに付いたコメントも削除されます</li>
                <li style={styles.li}>Google Drive内の添付ファイルとNaMaMeMoフォルダも削除します</li>
                <li style={styles.li}>この端末に残っている、このアプリの設定やキャッシュも消去されます</li>
              </ul>
              <p style={styles.p}>確認のため、下の欄に「削除」と入力してください。</p>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="削除"
                style={styles.input}
              />
              <div style={styles.btnRow}>
                <button style={styles.cancelBtn} onClick={onClose}>キャンセル</button>
                <button
                  style={{ ...styles.dangerBtn, opacity: canRun ? 1 : 0.45, cursor: canRun ? 'pointer' : 'not-allowed' }}
                  disabled={!canRun}
                  onClick={() => runDeletion(false)}
                >アカウントを削除する</button>
              </div>
            </>
          )}

          {phase === 'driveWarn' && (
            <>
              <p style={styles.p}>{driveWarnMsg}</p>
              <p style={styles.p}>Driveに残したファイルは、後からGoogle Driveで直接削除できます。</p>
              <div style={styles.btnRow}>
                <button style={styles.cancelBtn} onClick={onClose}>やめる</button>
                <button style={styles.dangerBtn} onClick={() => runDeletion(true)}>Driveのファイルを残して続行する</button>
              </div>
            </>
          )}

          {phase === 'working' && (
            <>
              <p style={styles.p}>削除しています。このままお待ちください…</p>
              {logs.map((l, i) => <p key={i} style={styles.logLine}>{l}</p>)}
            </>
          )}

          {phase === 'error' && (
            <>
              <p style={{ ...styles.p, color: '#c53030', fontWeight: 700 }}>削除を完了できませんでした。</p>
              <p style={styles.p}>{errorMsg}</p>
              <p style={styles.p}>途中で止まった場合でも、もう一度実行すれば続きから処理できます。</p>
              <div style={styles.btnRow}>
                <button style={styles.cancelBtn} onClick={onClose}>閉じる</button>
                <button style={styles.dangerBtn} onClick={() => { setInput(''); setPhase('confirm') }}>入力画面に戻る</button>
              </div>
            </>
          )}

          {phase === 'done' && (
            <>
              <p style={styles.p}>アカウントを削除しました。ご利用ありがとうございました。</p>
              <div style={styles.btnRow}>
                <button style={styles.dangerBtn} onClick={() => window.location.reload()}>ログイン画面に戻る</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--bg)', borderRadius: 16, width: 480, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 16, fontWeight: 700, color: '#c53030' },
  closeBtn: { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--text-muted)', width: 28, height: 28, borderRadius: 6 },
  body: { overflowY: 'auto', padding: '16px 20px 20px' },
  p: { fontSize: 13, color: 'var(--text)', lineHeight: 1.7, marginBottom: 10 },
  ul: { margin: '0 0 12px', paddingLeft: 20 },
  li: { fontSize: 13, color: 'var(--text)', lineHeight: 1.7, marginBottom: 4 },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 15, background: 'var(--bg)', color: 'var(--text)', outline: 'none', marginBottom: 16 },
  btnRow: { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
  cancelBtn: { padding: '9px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text)' },
  dangerBtn: { padding: '9px 16px', background: '#c53030', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: 'white', fontWeight: 700 },
  logLine: { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 2 },
}
