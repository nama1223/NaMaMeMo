import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { useDialog } from './DialogProvider'

// ログイン直後の初回設定画面。
// ニックネーム未登録のアカウントにだけ表示され、設定するまでアプリ本体には進めない。
export default function NicknameSetup({ onComplete }) {
  const { banner } = useDialog()
  const [nickname, setNickname] = useState('')
  const [saving, setSaving] = useState(false)

  const trimmed = nickname.trim()
  const canSave = trimmed.length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ data: { nickname: trimmed } })
      if (error) {
        banner('ニックネームの保存に失敗しました: ' + error.message)
        setSaving(false)
        return
      }
      onComplete(trimmed)
    } catch (e) {
      banner('ニックネームの保存に失敗しました: ' + e.message)
      setSaving(false)
    }
  }

  const handleSignOut = async () => {
    try { await supabase.auth.signOut() } catch { /* ログアウト失敗時は画面遷移しないだけなので無視 */ }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>📝 NaMaMeMo</h1>
        <p style={styles.subtitle}>はじめまして！</p>

        <p style={styles.description}>
          使い始める前に、ニックネームを設定してください。<br />
          管理者が誰のメモか分かるようにするための名前です。<br />
          後から設定で変更できます。
        </p>

        <div style={styles.inputWrap}>
          <label style={styles.label}>ニックネーム<span style={{ color: '#e53e3e' }}>（必須）</span></label>
          <input
            type="text"
            value={nickname}
            onChange={e => setNickname(e.target.value.slice(0, 20))}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="例：なまた"
            maxLength={20}
            style={styles.input}
            autoComplete="off"
            autoFocus
          />
        </div>

        <button
          style={{ ...styles.button, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed' }}
          onClick={canSave ? handleSave : undefined}
          disabled={!canSave}
        >
          {saving ? '保存中…' : 'このニックネームではじめる'}
        </button>

        <button style={styles.signOutLink} onClick={handleSignOut}>
          別のアカウントでログインし直す
        </button>
      </div>
    </div>
  )
}

const styles = {
  container: { display:'flex', justifyContent:'center', alignItems:'center', minHeight:'100dvh', background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding:'16px' },
  card: { background:'white', borderRadius:16, padding:'40px 36px', textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.2)', width:'100%', maxWidth:360 },
  title: { margin:'0 0 8px', fontSize:28, color:'#1a1a2e' },
  subtitle: { margin:'0 0 16px', color:'#666', fontSize:16, fontWeight:600 },
  description: { fontSize:13, color:'#444', lineHeight:1.8, margin:'0 0 20px' },
  inputWrap: { marginBottom:16, textAlign:'left' },
  label: { display:'block', fontSize:13, fontWeight:600, color:'#333', marginBottom:6 },
  input: { width:'100%', padding:'10px 12px', border:'2px solid #e0e0e0', borderRadius:8, fontSize:15, outline:'none', boxSizing:'border-box', transition:'border-color 0.2s', color:'#1a1a2e' },
  button: { width:'100%', padding:'12px 24px', background:'#667eea', border:'none', borderRadius:8, fontSize:16, fontWeight:600, transition:'all 0.2s', color:'white', marginTop:4 },
  signOutLink: { background:'none', border:'none', color:'#888', fontSize:12, cursor:'pointer', padding:'4px 0', textDecoration:'underline', marginTop:14 },
}
