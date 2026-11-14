import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { MAX_LOGIN_COUNT } from '../hooks/useSettings'
import { useDialog } from './DialogProvider'

export default function Auth({ limitReached = false }) {
  const { toast, banner } = useDialog()
  const [loginCount, setLoginCount] = useState(null)
  const [loadingCount, setLoadingCount] = useState(true)
  // 既存ユーザー：localStorage から保存済みニックネームを自動補完
  const [nickname, setNickname] = useState(() => {
    try {
      const s = localStorage.getItem('namamemo_settings')
      if (s) return JSON.parse(s)?.nickname || ''
    } catch {}
    return ''
  })
  const [showGuide, setShowGuide] = useState(false)
  // 既存ユーザー（localStorageに設定が存在する）かどうか
  const isReturningUser = (() => {
    try { return !!localStorage.getItem('namamemo_settings') } catch { return false }
  })()

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const { data, error } = await supabase.rpc('get_user_count')
        if (!error && typeof data === 'number') {
          setLoginCount(data); setLoadingCount(false); return
        }
      } catch {}
      setLoginCount(null); setLoadingCount(false)
    }
    fetchCount()
  }, [])

  const handleLogin = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) { toast('ニックネームを入力してください'); return }

    // ニックネームをOAuth完了後に拾えるよう一時保存
    sessionStorage.setItem('pending_nickname', trimmed)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/drive.file',
        queryParams: {
          access_type: 'offline',
          // 常に同意画面を表示してdrive.fileスコープ付きrefresh_tokenを確実に取得する
          prompt: 'consent',
        },
        redirectTo: window.location.origin + window.location.pathname,
      },
    })
    if (error) banner('ログインエラー: ' + error.message)
  }

  const isFull = loginCount !== null && loginCount >= MAX_LOGIN_COUNT
  // 既存ユーザーはニックネーム未入力でもログイン可。新規ユーザーは必須
  const canLogin = !isFull && !limitReached && (isReturningUser || nickname.trim().length > 0)

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>📝 NaMaMeMo</h1>
        <p style={styles.subtitle}>アウトラインプロセッサ型メモアプリ</p>

        {limitReached && (
          <div style={styles.errorBox}>
            ユーザー数が上限（{MAX_LOGIN_COUNT}人）に達しているため<br />ログインできませんでした。
          </div>
        )}

        {!limitReached && loginCount !== null && (
          <div style={styles.countBox}>
            <span style={styles.countLabel}>現在のユーザー数</span>
            <span style={styles.countValue}>{loadingCount ? '…' : `${loginCount} / ${MAX_LOGIN_COUNT}`}</span>
            {isFull && <span style={styles.fullBadge}>満員</span>}
          </div>
        )}

        {/* ニックネーム入力 */}
        {!isFull && !limitReached && (
          <div style={styles.nicknameWrap}>
            <label style={styles.nicknameLabel}>
              ニックネーム{isReturningUser ? <span style={{ fontWeight: 400, color: '#888', fontSize: 11 }}>（任意・変更する場合は入力）</span> : <span style={{ color: '#e53e3e' }}>（必須）</span>}
            </label>
            <input
              type="text"
              value={nickname}
              onChange={e => setNickname(e.target.value.slice(0, 20))}
              onKeyDown={e => e.key === 'Enter' && canLogin && handleLogin()}
              placeholder="例：なまた"
              maxLength={20}
              style={styles.nicknameInput}
              autoComplete="off"
            />
            <p style={styles.nicknameHint}>※ 管理者から誰が利用しているか識別するために使います。後から設定で変更できます。</p>
          </div>
        )}

        <button
          style={{ ...styles.button, opacity: canLogin ? 1 : 0.4, cursor: canLogin ? 'pointer' : 'not-allowed' }}
          onClick={canLogin ? handleLogin : undefined}
          disabled={!canLogin}
        >
          <GoogleIcon />
          {isFull ? 'ただいま満員です' : 'Googleでログイン'}
        </button>

        {isFull && !limitReached && (
          <p style={{ fontSize: 12, color: '#e53e3e', marginTop: 12, textAlign: 'center' }}>
            現在ユーザー数が上限（{MAX_LOGIN_COUNT}人）に達しています。
          </p>
        )}

        {/* ログイン手順の説明 */}
        {!isFull && !limitReached && (
          <div style={{ marginTop: 16 }}>
            <button style={styles.guideToggle} onClick={() => setShowGuide(v => !v)}>
              {showGuide ? '▲' : '▼'} ログインの手順を確認する
            </button>
            {showGuide && (
              <div style={styles.guideBox}>
                <p style={styles.guideTitle}>🔐 ログインの流れ</p>
                <ol style={styles.guideList}>
                  <li>上の入力欄にニックネームを入力します。</li>
                  <li>「Googleでログイン」を押すと、Googleの認証画面が開きます。</li>
                  <li>使用するGoogleアカウントを選択します。</li>
                  <li style={{ color: '#b45309' }}>
                    <strong>【初回のみ】</strong>「NaMaMeMoがGoogleドライブへのアクセスを求めています」という画面が表示されます。
                    「続行」または「許可」を押してください。
                    <br />※ この許可がないと画像・ファイルの添付機能が使えません。
                  </li>
                  <li>認証完了後、自動的にアプリに戻ります。</li>
                </ol>
                <p style={styles.guideNote}>
                  💡 2回目以降のログインは手順4の画面は表示されません。
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" style={{ marginRight: 10 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

const styles = {
  container: { display:'flex', justifyContent:'center', alignItems:'center', minHeight:'100dvh', background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding:'16px' },
  card: { background:'white', borderRadius:16, padding:'40px 36px', textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.2)', width:'100%', maxWidth:360 },
  title: { margin:'0 0 8px', fontSize:28, color:'#1a1a2e' },
  subtitle: { margin:'0 0 24px', color:'#666', fontSize:14 },
  errorBox: { padding:'10px 14px', background:'#fee2e2', borderRadius:8, marginBottom:16, fontSize:13, color:'#dc2626', fontWeight:600, textAlign:'center' },
  countBox: { display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:20, padding:'8px 16px', background:'#f7f7f8', borderRadius:10, border:'1px solid #e5e5e7' },
  countLabel: { fontSize:12, color:'#666' },
  countValue: { fontSize:16, fontWeight:700, color:'#1a1a2e', fontVariantNumeric:'tabular-nums' },
  fullBadge: { fontSize:10, background:'#e53e3e', color:'white', padding:'2px 6px', borderRadius:10, fontWeight:700 },
  nicknameWrap: { marginBottom:16, textAlign:'left' },
  nicknameLabel: { display:'block', fontSize:13, fontWeight:600, color:'#333', marginBottom:6 },
  nicknameInput: { width:'100%', padding:'10px 12px', border:'2px solid #e0e0e0', borderRadius:8, fontSize:15, outline:'none', boxSizing:'border-box', transition:'border-color 0.2s', color:'#1a1a2e' },
  nicknameHint: { fontSize:11, color:'#888', marginTop:5, lineHeight:1.5 },
  button: { display:'flex', alignItems:'center', justifyContent:'center', width:'100%', padding:'12px 24px', background:'white', border:'2px solid #e0e0e0', borderRadius:8, fontSize:16, transition:'all 0.2s', color:'#333', marginTop:4 },
  guideToggle: { background:'none', border:'none', color:'#667eea', fontSize:12, cursor:'pointer', padding:'4px 0', textDecoration:'underline' },
  guideBox: { marginTop:10, padding:'14px 16px', background:'#f8f7ff', borderRadius:10, border:'1px solid #d0caff', textAlign:'left' },
  guideTitle: { fontSize:13, fontWeight:700, color:'#4a4080', marginBottom:8 },
  guideList: { fontSize:12, color:'#444', lineHeight:1.8, paddingLeft:18, margin:'0 0 8px' },
  guideNote: { fontSize:11, color:'#667eea', margin:0 },
}
