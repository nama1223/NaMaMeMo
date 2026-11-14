import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from './supabaseClient'
import Auth from './components/Auth'
import { MAX_LOGIN_COUNT } from './hooks/useSettings'
import TreePane from './components/TreePane'
import EditorPane from './components/EditorPane'
import SettingsModal from './components/SettingsModal'
import ChangelogModal, { VERSION } from './components/ChangelogModal'
import AdminModal, { isAdmin } from './components/AdminModal'
import ReminderModal from './components/ReminderModal'
import DriveMigrationBar from './components/DriveMigrationBar'
import { useDriveMigration } from './hooks/useDriveMigration'
import { useNodes } from './hooks/useNodes'
import { useSettings, THEMES } from './hooks/useSettings'
import { useBackup } from './hooks/useBackup'
import { useCategories } from './hooks/useCategories'
import PublicViewer from './components/PublicViewer';
import ShareModal from './components/ShareModal';
import { clearDriveTokenCache } from './utils/driveToken'
import { withTimeout } from './utils/withTimeout'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { useDialog } from './components/DialogProvider'

function buildThemeVars(themeKey) {
  const t = THEMES[themeKey] || THEMES.light
  return Object.entries(t.vars).map(([k, v]) => `${k}: ${v};`).join('\n')
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
  button:hover { opacity: 0.85; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes gradientShift {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
`

const POS_CONFIG = {
  left:   { isH: true,  rev: false, openArrow: '▶', closeArrow: '◀' },
  right:  { isH: true,  rev: true,  openArrow: '◀', closeArrow: '▶' },
  top:    { isH: false, rev: false, openArrow: '▼', closeArrow: '▲' },
  bottom: { isH: false, rev: true,  openArrow: '▲', closeArrow: '▼' },
}

const GOOGLE_CLIENT_ID = '1004136161217-cjtlvco4jcvvden07u24lvdfbcsr9vh7.apps.googleusercontent.com'

async function checkNewUserLimit() {
  try {
    const { data: myData } = await supabase.from('categories').select('id').limit(1)
    if (myData?.length > 0) return false // 既存ユーザーは常に許可
    const { data: count, error } = await supabase.rpc('get_user_count')
    if (error) return false // RPC未設定の場合は許可
    return count >= MAX_LOGIN_COUNT
  } catch { return false }
}

const MIN_SIZE = 120, MAX_SIZE = 480
// 上下配置のときは画面の高さ基準、左右のときは幅基準
const getMaxSize = (pos) => {
  if (pos === 'top' || pos === 'bottom') {
    return Math.min(480, Math.floor((window.innerHeight - 48) * 0.82))
  }
  return Math.min(480, Math.floor(window.innerWidth * 0.82))
}
const EAR_W = 28, EAR_H = 44, TAB_PX = 4
const RESIZE_LONGPRESS_MS = 400

export default function App() {
  const { toast: notifyToast, banner } = useDialog()
  const urlParams = new URLSearchParams(window.location.search);
  let publicId = urlParams.get('p');
  
  if (publicId) {
    publicId = publicId.replace(/[^a-fA-F0-9-]/g, '');
    if (publicId) {
      return <PublicViewer rootId={publicId} />;
    }
  }

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [reminderModal, setReminderModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [resizeDragMode, setResizeDragMode] = useState(false)
  const [updateBanner, setUpdateBanner] = useState(false)
  const [previewTheme, setPreviewTheme] = useState(null)
  const [shareModal, setShareModal] = useState(null) // { title, text, url, files:[] }
  const [driveReconnectStatus, setDriveReconnectStatus] = useState(null) // null | 'needed' | 'connecting' （Edge Function が失敗した場合のみ 'needed' になる）
  const [loginLimitReached, setLoginLimitReached] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const driveCallbackQueue = useRef([])

  const { settings, updateSettings } = useSettings()
  const isOnline = useOnlineStatus()
  const pos = settings.treePosition || 'left'
  const cfg = POS_CONFIG[pos] || POS_CONFIG.left
  const paneSize = settings.paneSize ?? 260
  const setPaneSize = useCallback((v) => {
    updateSettings({ paneSize: typeof v === 'function' ? v(settings.paneSize ?? 260) : v })
  }, [settings.paneSize, updateSettings])

  const dragState = useRef({ active: false, startCoord: 0, startSize: 0 })
  const paneSizeRef = useRef(paneSize)
  const rafId = useRef(null)
  const longPressTimer = useRef(null)
  const resizeDragModeRef = useRef(false)
  // フルオープン前のサイズを記憶する
  const prevPaneSizeRef = useRef(null)

  const {
    categories, activeCategoryId, setActiveCategoryId,
    addCategory, renameCategory, deleteCategory, reorderCategories,
    migrateUncategorizedNodes,
    fetchError: categoriesFetchError, refetchCategories,
  } = useCategories(session?.user?.id)

  const {
    nodes, loading: nodesLoading, setNodes,
    addAfter, addBefore, addChild,
    deleteNode, updateTitle, toggleExpanded, updateContent, updateNodeStyle,
    moveNode, moveNodeTo, moveToCategoryBranch,
    moveToTrash, restoreFromTrash, emptyTrash,
    isTrashNode,
    getLastSelectedId, saveLastSelectedId,
    registerExternalUpdateHandler,
    syncOfflineChanges,
  } = useNodes(session?.user?.id, activeCategoryId)

  const { runBackup, fetchBackupList, fetchBackupAt } = useBackup(
    session?.user?.id, nodes, settings
  )

  const selectedNode = nodes.find(n => n.id === selectedId) || null
  const userEmail = session?.user?.email || ''
  const userIsAdmin = isAdmin(userEmail)

  // ★ 追加：Google Identity Servicesのスクリプトをグローバルにロード（いつでも更新できるようにする）
  useEffect(() => {
    if (!document.getElementById('google-gsi-script')) {
      const script = document.createElement('script');
      script.id = 'google-gsi-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // Drive: キューにあるコールバックを全部新トークンで解決する
  const flushDriveQueue = useCallback((token) => {
    const queue = driveCallbackQueue.current.splice(0)
    queue.forEach(cb => cb(token))
  }, [])

  // Drive: フル認証（ユーザー操作が必要な場合）
  const triggerDriveFullAuth = useCallback(async () => {
    if (!window.google) {
      setDriveReconnectStatus('needed')
      banner('Google APIが読み込まれていません。ページをリロードしてから再接続してください。')
      return
    }
    setDriveReconnectStatus('connecting')
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (res) => {
        if (res.error) {
          console.error('[Drive] フル認証失敗:', res.error)
          setDriveReconnectStatus('needed')
          flushDriveQueue(null)
        } else {
          updateSettings({
            googleDriveToken: res.access_token,
            googleDriveTokenExpiry: Date.now() + (res.expires_in * 1000),
          })
          flushDriveQueue(res.access_token)
          setDriveReconnectStatus(null)
        }
      },
    })
    // login_hint でログイン中のアカウントに固定（別アカウントで認証させない）
    tokenClient.requestAccessToken({
      prompt: 'consent',
      login_hint: session?.user?.email || '',
    })
  }, [updateSettings, flushDriveQueue, session?.user?.email, banner])

  // Drive: サイレント更新（失敗時はバナーを出してキューに積む）
  useEffect(() => {
    const handleTokenRefresh = (e) => {
      const { callback } = e.detail
      if (!window.google) {
        // GISスクリプト未ロード（リロード直後等）→ バナーは出さずキューに積むだけ
        // driveToken.js のEdge Functionフォールバックが先に動くはずなので通常ここには来ない
        driveCallbackQueue.current.push(callback)
        return
      }
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (res) => {
          if (res.error) {
            console.warn('[Drive] サイレント更新失敗:', res.error)
            driveCallbackQueue.current.push(callback)
            setDriveReconnectStatus('needed')
          } else {
            updateSettings({
              googleDriveToken: res.access_token,
              googleDriveTokenExpiry: Date.now() + (res.expires_in * 1000),
            })
            callback(res.access_token)
          }
        },
      })
      tokenClient.requestAccessToken({ prompt: '', login_hint: session?.user?.email || '' })
    }
    window.addEventListener('refresh-drive-token', handleTokenRefresh)
    return () => window.removeEventListener('refresh-drive-token', handleTokenRefresh)
  }, [updateSettings]);

  // Drive: Edge Function により自動更新されるため、手動チェック不要
  // （GIS トークン期限切れ警告は削除。Edge Function が失敗した場合のみ 'needed' バナーを表示）

  useEffect(() => {
    registerExternalUpdateHandler?.(() => setUpdateBanner(true))
  }, [registerExternalUpdateHandler])

  // オンライン復帰時にオフラインキューを同期
  const prevIsOnline = useRef(true)
  useEffect(() => {
    if (isOnline && !prevIsOnline.current && session?.user?.id) {
      syncOfflineChanges?.()
    }
    prevIsOnline.current = isOnline
  }, [isOnline, session?.user?.id])

  useEffect(() => {
    if (activeCategoryId && session?.user?.id) migrateUncategorizedNodes(activeCategoryId)
  }, [activeCategoryId, session?.user?.id])

  useEffect(() => {
    if (!activeCategoryId || nodesLoading) return
    // ★ URLパラメータ ?node=ID を最優先（lastSelectedIdより先に処理）
    const urlNode = new URLSearchParams(window.location.search).get('node')
    if (urlNode) {
      const found = nodes.find(n => n.id === urlNode)
      if (found) {
        setSelectedId(found.id)
        saveLastSelectedId(found.id)
        // URLからパラメータを除去（履歴を汚さない）
        window.history.replaceState({}, '', window.location.pathname)
        return
      }
    }
    // sessionStorage（PWAインストール後のノードジャンプ）
    try {
      const pwaNode = sessionStorage.getItem('pwa_launch_node')
      if (pwaNode) {
        sessionStorage.removeItem('pwa_launch_node')
        const found = nodes.find(n => n.id === pwaNode)
        if (found) { setSelectedId(found.id); saveLastSelectedId(found.id); return }
      }
    } catch (e) {}
    // 通常：最後に開いていたノード
    const lastId = getLastSelectedId()
    if (lastId && nodes.find(n => n.id === lastId)) setSelectedId(lastId)
    else setSelectedId(null)
  }, [activeCategoryId, nodesLoading])


  const handleTogglePublic = async (nodeId, isPublic) => {
    const { error } = await supabase.from('nodes').update({ is_public: isPublic }).eq('id', nodeId);
    if (error) {
      banner('公開設定の変更に失敗しました: ' + error.message);
    } else {
      if (setNodes) {
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, is_public: isPublic } : n));
      } else {
         // トーストを表示してから再読み込みし、完了報告が見える時間を確保する。
         notifyToast(isPublic ? '🌐 このメモを公開しました！\nURLを知っている人は誰でも閲覧できます。' : '🔒 公開を停止しました。');
         window.setTimeout(() => window.location.reload(), 4000);
         return;
      }
      notifyToast(isPublic ? '🌐 このメモを公開しました！\nURLを知っている人は誰でも閲覧できます。' : '🔒 公開を停止しました。');
    }
  };

  const handleCopyPublicUrl = async (nodeId) => {
    const url = `${window.location.origin}${window.location.pathname}?p=${nodeId}`;
    try {
      await navigator.clipboard.writeText(url)
      notifyToast('公開用リンクをコピーしました！\nシークレットウィンドウ等で確認してみてください。\n\n' + url)
    } catch {
      banner('コピーに失敗しました。以下のURLを手動でコピーしてください:\n' + url)
    }
  };

  const handleRestoreBackup = useCallback(async (backupNodes) => {
    if (!session?.user?.id) return
    await Promise.all(backupNodes.map(b =>
      supabase.from('nodes').update({ title: b.title, content: b.content }).eq('id', b.node_id).eq('user_id', session.user.id)
    ))
    window.location.reload()
  }, [session?.user?.id])

  const activeTheme = previewTheme || settings.theme || 'light'
  useEffect(() => {
    const existing = document.getElementById('namamemo-theme')
    if (existing) existing.remove()
    const styleEl = document.createElement('style')
    styleEl.id = 'namamemo-theme'
    styleEl.textContent = `:root {\n${buildThemeVars(activeTheme)}\n}\n${BASE_CSS}`
    document.head.appendChild(styleEl)
    return () => styleEl.remove()
  }, [activeTheme])

  useEffect(() => {
    // 起動時セッション確認。トークン期限切れ時は裏で更新通信が走るが、
    // 電波の弱い場所ではその通信が宙吊りになり getSession が返らないことがある。
    // 5秒で見切って、端末内に保存済みのセッションがあればそれで起動を続行する
    // （メモ表示は端末内キャッシュでまかない、認証の追いつきは onAuthStateChange に任せる）。
    let sessionApplied = false
    const applySession = (s) => {
      if (sessionApplied) return
      sessionApplied = true
      setSession(s)
      setLoading(false)
      // メタデータのニックネームをローカル設定に同期（他端末で変更した場合を考慮）
      if (s?.user?.user_metadata?.nickname) {
        updateSettings({ nickname: s.user.user_metadata.nickname })
      }
    }
    const readStoredSession = () => {
      try {
        const ref = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]
        const raw = localStorage.getItem(`sb-${ref}-auth-token`)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        const s = parsed?.currentSession ?? parsed?.session ?? parsed
        return s?.access_token && s?.user ? s : null
      } catch { return null }
    }
    withTimeout(supabase.auth.getSession(), 5000, 'getSession timeout')
      .then(({ data: { session } }) => applySession(session))
      .catch(() => {
        console.warn('[Auth] getSession timeout/error – using stored session')
        applySession(readStoredSession())
      })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && _event === 'SIGNED_IN') {
        // Supabase のロックを保持したままコールバック内で非同期処理すると
        // デッドロックになるため、setTimeout で外に出す
        setTimeout(async () => {
          // provider_refresh_token は OAuth 直後のこのタイミングにしか含まれない → 即保存
          if (session.provider_refresh_token) {
            updateSettings({ googleProviderRefreshToken: session.provider_refresh_token })
          }

          // Drive連携は常時有効（ログイン＝Drive認証済みのため）
          updateSettings({ useGoogleDrive: true })

          // ユーザー上限チェック（既存ユーザーはカテゴリ1件取得のみで即 false）
          const isOver = await checkNewUserLimit()
          if (isOver) {
            await supabase.auth.signOut({ scope: 'local' })
            setLoginLimitReached(true)
            setLoading(false)
            return
          }

          // セッションを即座にセット → アプリを表示（ニックネーム保存を待たない）
          setSession(session)
          setLoading(false)

          // ニックネームはバックグラウンドで保存（ブロッキングしない）
          const pendingNickname = sessionStorage.getItem('pending_nickname')
          const existingNickname = session.user?.user_metadata?.nickname
          if (pendingNickname) {
            sessionStorage.removeItem('pending_nickname')
            // 既存ユーザー（Supabaseにニックネームがすでにある）は入力値で上書きしない
            if (!existingNickname) {
              supabase.auth.updateUser({ data: { nickname: pendingNickname } })
                .then(() => updateSettings({ nickname: pendingNickname }))
                .catch(e => console.warn('[Auth] ニックネーム保存失敗:', e))
            } else {
              // 既存ユーザーはSupabase側の正のニックネームを使う
              updateSettings({ nickname: existingNickname })
            }
          } else if (existingNickname) {
            // 既存ユーザー：メタデータのニックネームをローカル設定に同期
            updateSettings({ nickname: existingNickname })
          }
        }, 0)
        return
      }
      setSession(session)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  // ★ OAuth ログイン後に SW が待機中なら自動で更新（古いキャッシュを一掃）
  useEffect(() => {
    if (!session) return
    // 新しい SW が waiting 状態なら skipWaiting → リロード
    navigator.serviceWorker?.ready.then(reg => {
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        setTimeout(() => window.location.reload(), 300)
      }
    })
  }, [!!session]) // session の有無が変わったとき（ログイン直後）だけ実行

  // ★ PWA ホーム画面追加プロンプトを保存
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      window.__pwaInstallPrompt = e
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // ★ シェアターゲット受信処理（?shared=1 のとき）
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    if (!urlParams.has('shared')) return

    const BASE = import.meta.env.BASE_URL || '/NaMaMeMo/'

    const processShare = async () => {
      try {
        const cache = await caches.open('tmp-share-data')
        const res = await cache.match(new Request(BASE + 'shared-post-data'))
        if (!res) return

        const data = await res.json()
        const { title = '', text = '', url = '', fileKeys = [] } = data

        // ファイルを取得
        const files = []
        for (const fileUrl of fileKeys) {
          const fileRes = await cache.match(new Request(fileUrl))
          if (fileRes) {
            const blob = await fileRes.blob()
            const name = decodeURIComponent(fileUrl.split('/').pop())
            // blob.typeが空の場合はContent-Typeヘッダーから取得
            const type = blob.type || fileRes.headers.get('Content-Type') || ''
            // MIMEが不明な場合は拡張子から推定
            const guessType = (name, type) => {
              if (type) return type
              const ext = name.split('.').pop()?.toLowerCase() || ''
              const map = { pdf:'application/pdf', mp4:'video/mp4', mov:'video/quicktime',
                avi:'video/x-msvideo', mkv:'video/x-matroska', mp3:'audio/mpeg',
                m4a:'audio/mp4', wav:'audio/wav', ogg:'audio/ogg',
                jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
                gif:'image/gif', webp:'image/webp' }
              return map[ext] || 'application/octet-stream'
            }
            files.push({ blob, name, type: guessType(name, type), url: fileUrl })
          }
        }

        // モーダルを表示
        setShareModal({ title, text, url, files })

        // キャッシュを掃除
        await cache.delete(new Request(BASE + 'shared-post-data'))
        for (const fileUrl of fileKeys) {
          await cache.delete(new Request(fileUrl))
        }
      } catch (e) {
        console.warn('シェアデータ取得失敗:', e)
      } finally {
        // URLを掃除（リロード時の再取込防止）
        window.history.replaceState({}, '', window.location.pathname)
      }
    }

    processShare()
  }, []) // マウント時1回だけ



  const startDrag = useCallback((clientX, clientY) => {
    dragState.current = { active: true, startCoord: cfg.isH ? clientX : clientY, startSize: paneSizeRef.current }
    document.body.style.userSelect = 'none'
  }, [cfg])

  const onEarTouchStart = useCallback((e) => {
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30)
      resizeDragModeRef.current = true; setResizeDragMode(true)
      startDrag(touch.clientX, touch.clientY)
    }, RESIZE_LONGPRESS_MS)
  }, [startDrag])

  const onEarTouchMove = useCallback((e) => {
    if (!resizeDragModeRef.current || !dragState.current.active) return
    e.preventDefault()
    const touch = e.touches[0]
    const current = cfg.isH ? touch.clientX : touch.clientY
    const delta = cfg.rev ? dragState.current.startCoord - current : current - dragState.current.startCoord
    const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, dragState.current.startSize + delta))
    paneSizeRef.current = next
    if (rafId.current) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => setPaneSize(next))
  }, [cfg, setPaneSize])

  // スマホ耳タッチ終了（kind: 'close'|'mid'|'open'）
  const makeEarTouchEnd = useCallback((kind) => () => {
    clearTimeout(longPressTimer.current)
    if (resizeDragModeRef.current) {
      resizeDragModeRef.current = false; setResizeDragMode(false)
      dragState.current.active = false; document.body.style.userSelect = ''
      return
    }
    // タップ時の各ボタン動作
    if (kind === 'close') {
      updateSettings({ showTree: false })
    } else if (kind === 'mid') {
      if (!settings.showTree) {
        updateSettings({ showTree: true })
      } else if (paneSizeRef.current >= getMaxSize(pos) - 10) {
        const prev = prevPaneSizeRef.current ?? 260
        setPaneSize(prev)
        updateSettings({ showTree: true, paneSize: prev })
      }
    } else if (kind === 'open') {
      const ms = getMaxSize(pos)
      if (paneSizeRef.current < ms - 10) {
        prevPaneSizeRef.current = paneSizeRef.current
      }
      setPaneSize(ms)
      updateSettings({ showTree: true, paneSize: ms })
    }
  }, [settings.showTree, updateSettings, setPaneSize])
  // 後方互換（長押しドラッグ共通部分）
  const onEarTouchEnd = makeEarTouchEnd('close')

  const onHandleMouseDown = useCallback((e) => { e.preventDefault(); startDrag(e.clientX, e.clientY) }, [startDrag])

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragState.current.active || resizeDragModeRef.current) return
      const current = cfg.isH ? e.clientX : e.clientY
      const delta = cfg.rev ? dragState.current.startCoord - current : current - dragState.current.startCoord
      const next = Math.min(getMaxSize(pos), Math.max(MIN_SIZE, dragState.current.startSize + delta))
      paneSizeRef.current = next
      if (rafId.current) cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => setPaneSize(next))
    }
    const onMouseUp = () => {
      if (!dragState.current.active) return
      dragState.current.active = false; document.body.style.cursor = ''; document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [cfg, setPaneSize])

  useEffect(() => { paneSizeRef.current = paneSize }, [paneSize])

  // ── Drive移設 ──
  const {
    running: migRunning, current: migCurrent, stats: migStats,
    hasWork: migHasWork, pendingCount: migPending,
    enqueueNodes, startMigration, stopMigration, retryFailed, clearCompleted,
  } = useDriveMigration(session?.user?.id, settings, updateSettings)

  // ── Drive 診断 ──
  const runDriveDiagnostics = useCallback(async () => {
    if (!selectedId) {
      notifyToast('診断結果を書き出すメモを先に選択してください')
      return
    }
    const lines = [
      '📋 Drive連携 診断レポート',
      `実行日時: ${new Date().toLocaleString('ja-JP')}`,
      '─'.repeat(44),
    ]

    // 【1】設定確認
    lines.push('\n【1】フロント設定')
    lines.push(`  useGoogleDrive : ${settings?.useGoogleDrive ? '✅ ON' : '⚪ OFF（ログイン時に自動ON）'}`)
    lines.push(`  googleDriveToken（キャッシュ）: ${settings?.googleDriveToken ? '✅ あり' : '⚪ なし（Edge Functionで動的取得）'}`)
    if (settings?.googleDriveTokenExpiry) {
      const rem = settings.googleDriveTokenExpiry - Date.now()
      lines.push(`  tokenExpiry : ${rem > 0 ? `✅ あと約 ${Math.round(rem / 60000)} 分` : `❌ ${Math.round(-rem / 60000)} 分前に期限切れ`}`)
    } else {
      lines.push('  tokenExpiry : ❌ 未設定')
    }
    lines.push(`  googleProviderRefreshToken : ${settings?.googleProviderRefreshToken ? '✅ 保存済み（Edge Function で使用可能）' : '❌ なし → 再ログインで取得'}`)


    // 【2】Supabase セッション
    lines.push('\n【2】Supabase セッション')
    let sessionAccessToken = null
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) throw error
      if (session) {
        sessionAccessToken = session.access_token
        lines.push('  セッション : ✅ あり')
        lines.push(`  provider_token : ${session.provider_token ? '✅ あり' : '❌ なし（再ログイン推奨）'}`)
        lines.push(`  access_token : ${session.access_token ? '✅ あり' : '❌ なし'}`)
      } else {
        lines.push('  セッション : ❌ なし（未ログイン？）')
      }
    } catch (e) {
      lines.push(`  エラー : ❌ ${e.message}`)
    }

    // 【3】Edge Function 疎通
    lines.push('\n【3】Edge Function (refresh-drive-token)')
    let edgeToken = null
    if (!sessionAccessToken) {
      lines.push('  スキップ（Supabase セッションなし）')
    } else {
      try {
        // hint_refresh_token を body に含める（driveToken.js と同じ仕様）
        const diagBody = settings?.googleProviderRefreshToken
          ? JSON.stringify({ hint_refresh_token: settings.googleProviderRefreshToken })
          : '{}'
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-drive-token`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sessionAccessToken}`,
              'Content-Type': 'application/json',
            },
            body: diagBody,
          }
        )
        const data = await res.json()
        lines.push(`  HTTP ステータス : ${res.ok ? '✅' : '❌'} ${res.status}`)
        if (res.ok && data.access_token) {
          edgeToken = data.access_token
          lines.push('  access_token 取得 : ✅ 成功')
          lines.push(`  expires_in : ${data.expires_in} 秒`)
        } else {
          lines.push(`  エラー : ❌ ${data.error || JSON.stringify(data)}`)
          if (data.error === 'no_refresh_token') {
            lines.push('  → 対処: 一度ログアウトして再ログインしてください')
          } else if (data.error === 'invalid_client') {
            lines.push('  → 対処: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET の Secrets 設定を確認')
          } else if (res.status === 404) {
            lines.push('  → 対処: Edge Function がデプロイされていません')
          } else if (res.status === 401) {
            lines.push('  → 対処: Supabase の access_token が無効です')
          } else if (res.status === 500) {
            lines.push('  → 対処: Edge Function 内部エラー。Secrets が正しく設定されているか確認')
          }
        }
      } catch (e) {
        lines.push(`  接続エラー : ❌ ${e.message}`)
        if (e.message.includes('fetch')) {
          lines.push('  → 対処: Edge Function の URL が正しいか、CORS 設定を確認')
        }
      }
    }

    // 【4】Google Drive API 疎通
    lines.push('\n【4】Google Drive API')
    if (!edgeToken) {
      lines.push('  スキップ（Edge Function からトークンを取得できなかったため）')
    } else {
      try {
        const driveRes = await fetch(
          'https://www.googleapis.com/drive/v3/about?fields=user',
          { headers: { Authorization: `Bearer ${edgeToken}` } }
        )
        const driveData = await driveRes.json()
        if (driveRes.ok && driveData.user) {
          lines.push('  API 疎通 : ✅ 成功')
          lines.push(`  Google アカウント : ${driveData.user.displayName} (${driveData.user.emailAddress})`)
        } else {
          lines.push(`  API 疎通 : ❌ 失敗`)
          lines.push(`  エラー : ${driveData.error?.message || JSON.stringify(driveData)}`)
          if (driveData.error?.status === 'UNAUTHENTICATED') {
            lines.push('  → 対処: トークンが無効です。再ログインを試してください')
          }
        }
      } catch (e) {
        lines.push(`  API 疎通エラー : ❌ ${e.message}`)
      }
    }

    // 【総合判定】
    lines.push('\n' + '─'.repeat(44))
    // googleDriveTokenなし・useGoogleDriveなしは正常（動的取得のため）
    // Drive API疎通の成否で判定する
    const hasApiSuccess = lines.some(l => l.includes('API 疎通 : ✅'))
    const hasCriticalError = lines.some(l => l.includes('❌') && !l.includes('googleDriveToken') && !l.includes('tokenExpiry') && !l.includes('provider_token') && !l.includes('useGoogleDrive'))
    lines.push(hasApiSuccess && !hasCriticalError
      ? '✅ 全チェック通過。Drive 連携は正常です！'
      : '❌ 問題が検出されました。上記の「→ 対処」を確認してください。'
    )

    const resultText = lines.join('\n')
    const escaped = resultText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const resultHtml = `<pre style="background:#1a1a1a;color:#d4d4d4;padding:14px 16px;border-radius:8px;font-size:12px;line-height:1.7;white-space:pre-wrap;font-family:'Consolas','Menlo',monospace">${escaped}</pre>`

    const currentNode = nodes.find(n => n.id === selectedId)
    await updateContent(selectedId, resultHtml + (currentNode?.content || '<p></p>'))
    setToast('📋 診断完了 — メモの先頭に結果を書き出しました')
    setTimeout(() => setToast(null), 4000)
  }, [selectedId, settings, nodes, updateContent])

  const toastTimerRef = useRef(null)
  const showToast = useCallback((msg) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const handleSelect = useCallback((id) => { setSelectedId(id); saveLastSelectedId(id) }, [saveLastSelectedId])
  const handleAddAfter = useCallback(async (node) => { const n = await addAfter(node); if (n) { setSelectedId(n.id); saveLastSelectedId(n.id) } }, [addAfter, saveLastSelectedId])
  const handleAddBefore = useCallback(async (node) => { const n = await addBefore(node); if (n) { setSelectedId(n.id); saveLastSelectedId(n.id) } }, [addBefore, saveLastSelectedId])
  const handleAddChild = useCallback(async (node) => { const n = await addChild(node); if (n) { setSelectedId(n.id); saveLastSelectedId(n.id) } }, [addChild, saveLastSelectedId])
  const handleDelete = useCallback((nodeId) => { deleteNode(nodeId); setSelectedId(null); saveLastSelectedId(null) }, [deleteNode, saveLastSelectedId])
  const handleMoveToTrash = useCallback(async (nodeId) => {
    await moveToTrash(nodeId)
    setSelectedId(null)
    saveLastSelectedId(null)
  }, [moveToTrash, saveLastSelectedId])
  const handleRestoreFromTrash = useCallback(async (nodeId) => {
    await restoreFromTrash(nodeId)
    setSelectedId(null)
    saveLastSelectedId(null)
  }, [restoreFromTrash, saveLastSelectedId])
  const handleEmptyTrash = useCallback(async () => {
    await emptyTrash()
  }, [emptyTrash])

  // ── ノードのインポート ──
  const handleImportFile = useCallback(async (file) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (data.format === 'nmmm1') {
        // 単一ノードをツリー最下段に追加
        const siblings = nodes.filter(n => !n.parent_id)
        const maxPos = siblings.length > 0 ? Math.max(...siblings.map(n => n.position || 0)) : -1
        const { data: newNode, error } = await supabase
          .from('nodes')
          .insert({
            user_id: session.user.id,
            category_id: activeCategoryId,
            title: data.node.title || 'インポート',
            content: data.node.content || '',
            parent_id: null,
            position: maxPos + 1,
            title_style: data.node.title_style || null,
            is_expanded: false,
          })
          .select().single()
        if (error) throw new Error(error.message)
        showToast('✅ インポート完了: ' + newNode.title)
        // Drive移設キューに積む
        await enqueueNodes([newNode])
        window.location.reload()

      } else if (data.format === 'nmmmg' || data.format === 'nmmmf') {
        // ツリー構造ごとインポート（nmmmg=子孫付き, nmmmf=全ノード）
        const rootSiblings = nodes.filter(n => !n.parent_id)
        const maxPos = rootSiblings.length > 0 ? Math.max(...rootSiblings.map(n => n.position || 0)) : -1
        // IDマッピング（旧ID→新ID）
        const idMap = {}
        const importedNodesMap = {} // 新ID→ノードデータ（Drive移設用）
        // ルートノードを先に挿入
        // nmmmf(全ノード)はrootIdなし → 全ルートノードを挿入
        const isFullExport = data.format === 'nmmmf' && !data.rootId
        const rootNode = isFullExport ? null : data.nodes.find(n => n.id === data.rootId)
        if (!isFullExport && !rootNode) throw new Error('ルートノードが見つかりません')
        // 深さ優先でノードを挿入
        const insertNode = async (n, newParentId, newPosition) => {
          const { data: inserted, error } = await supabase
            .from('nodes')
            .insert({
              user_id: session.user.id,
              category_id: activeCategoryId,
              title: n.title || '無題',
              content: n.content || '',
              parent_id: newParentId,
              position: newPosition,
              title_style: n.title_style || null,
              is_expanded: n.is_expanded ?? false,
            })
            .select().single()
          if (error) throw new Error(error.message)
          idMap[n.id] = inserted.id
          importedNodesMap[inserted.id] = inserted
          // 子ノードを再帰的に挿入
          const children = data.nodes
            .filter(c => c.parent_id === n.id)
            .sort((a, b) => (a.position || 0) - (b.position || 0))
          for (let i = 0; i < children.length; i++) {
            await insertNode(children[i], inserted.id, i)
          }
        }
        if (isFullExport) {
          // nmmmf: 全ルートノードを挿入（ツリー構造ごと）
          const roots = data.nodes.filter(n => !n.parent_id || !data.nodes.find(p => p.id === n.parent_id))
            .sort((a, b) => (a.position || 0) - (b.position || 0))
          for (let i = 0; i < roots.length; i++) {
            await insertNode(roots[i], null, maxPos + 1 + i)
          }
          showToast(`✅ インポート完了: ${data.nodes.length}件`)
        } else {
          await insertNode(rootNode, null, maxPos + 1)
          showToast(`✅ インポート完了: ${rootNode.title} (${data.nodes.length}件)`)
        }
        // Drive移設キューに積む（全インポートノード）
        const allImported = Object.values(idMap).map(id => importedNodesMap?.[id]).filter(Boolean)
        if (allImported.length > 0) await enqueueNodes(allImported)
        window.location.reload()

      } else {
        notifyToast('未対応のファイル形式です')
      }
    } catch (err) {
      banner('インポートに失敗しました: ' + err.message)
    }
  }, [nodes, session?.user?.id, activeCategoryId, showToast])

  const handleMoveNode = useCallback(async (nodeId, dir) => await moveNode(nodeId, dir), [moveNode])
  const handleMoveNodeTo = useCallback(async (nodeId, targetId, p) => await moveNodeTo(nodeId, targetId, p), [moveNodeTo])
  const handleMoveToCategoryBranch = useCallback(async (nodeId, targetCategoryId) => {
    const ok = await moveToCategoryBranch(nodeId, targetCategoryId)
    if (ok) {
      // 移動後、移動先カテゴリに切り替えて移動したノードを選択
      setActiveCategoryId(targetCategoryId)
    }
    return ok
  }, [moveToCategoryBranch, setActiveCategoryId])

  const openReminderModal = useCallback((node) => setReminderModal({ node }), [])

  // リマインダー通知タップ → ノードにジャンプ
  useEffect(() => {
    const handler = (e) => {
      const { nodeId } = e.detail || {}
      if (!nodeId) return
      const found = nodes.find(n => n.id === nodeId)
      if (found) { setSelectedId(nodeId); saveLastSelectedId(nodeId) }
    }
    window.addEventListener('namamemo-navigate-node', handler)
    return () => window.removeEventListener('namamemo-navigate-node', handler)
  }, [nodes, saveLastSelectedId])

  // 添付ファイルのノード間移動（移動先ノードの先頭に挿入）
  const handleNavigateAttachment = useCallback(async (data, targetNodeId, sourceNodeId, sourceEditor) => {
    const targetNode = nodes.find(n => n.id === targetNodeId)
    if (!targetNode) return
    // 移動元からノードを削除
    if (sourceEditor) {
      let deletedPos = null
      sourceEditor.state.doc.descendants((docNode, pos) => {
        if (deletedPos !== null) return false
        const match = data.type==='image' ? (docNode.type.name==='image' && docNode.attrs.src===data.src)
          : data.type==='audio' ? (docNode.type.name==='driveAudio' && docNode.attrs.driveId===data.driveId)
          : data.type==='video' ? (docNode.type.name==='driveVideo' && docNode.attrs.driveId===data.driveId)
          : data.type==='pdf'   ? (docNode.type.name==='drivePdf'   && docNode.attrs.driveId===data.driveId)
          : (docNode.type.name==='fileAttachment' && docNode.attrs.filename===data.filename)
        if (match) { deletedPos = pos; return false }
      })
      if (deletedPos !== null) {
        sourceEditor.chain().command(({ tr, state }) => {
          const n = state.doc.nodeAt(deletedPos)
          if (n) { tr.delete(deletedPos, deletedPos + n.nodeSize); return true }
          return false
        }).run()
      }
    }
    // 移動先ノードの先頭に追加（HTMLを先頭に挿入）
    let attachHtml = ''
    if (data.type==='image') attachHtml = `<img src="${data.src}"${data.driveId?` data-drive-id="${data.driveId}"`:''}/>`
    else if (data.type==='audio') attachHtml = `<div data-drive-audio="" data-drive-id="${data.driveId}" data-filename="${data.filename||''}" data-mimetype=""></div>`
    else if (data.type==='video') attachHtml = `<div data-drive-video="" data-drive-id="${data.driveId}" data-filename="${data.filename||''}" data-thumb-src="" data-mimetype=""></div>`
    else if (data.type==='pdf') attachHtml = `<span data-drive-pdf="" data-drive-id="${data.driveId}" data-filename="${data.filename||''}"></span>`
    else attachHtml = `<div class="file-attachment-node" data-filename="${data.filename}" data-content="${(data.content||'').replace(/"/g,'&quot;')}"><span>📄 ${data.filename}</span></div>`
    const newContent = attachHtml + (targetNode.content || '<p></p>')
    await updateContent(targetNodeId, newContent)
    showToast(`「${targetNode.title||'無題'}」の先頭に移動しました`)
  }, [nodes, updateContent, showToast])

  if (loading) return <Spinner />
  if (loginLimitReached) return <Auth limitReached />
  if (!session) return <Auth />

  const earBase = {
    position: 'absolute', padding: 0, border: '1px solid var(--border)',
    background: resizeDragMode ? 'var(--accent)' : 'var(--surface)',
    color: resizeDragMode ? 'white' : 'var(--text-muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 20, fontSize: 10, lineHeight: 1,
    userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
    transition: 'background 0.2s, color 0.2s',
  }
  const earStyle = {
    left:   { ...earBase, right: -EAR_W, top: '50%', transform: 'translateY(-50%)', width: EAR_W, height: EAR_H, borderLeft: 'none', borderRadius: '0 10px 10px 0', boxShadow: '3px 0 8px rgba(0,0,0,0.08)' },
    right:  { ...earBase, left: -EAR_W,  top: '50%', transform: 'translateY(-50%)', width: EAR_W, height: EAR_H, borderRight: 'none', borderRadius: '10px 0 0 10px', boxShadow: '-3px 0 8px rgba(0,0,0,0.08)' },
    top:    { ...earBase, bottom: -EAR_W, left: '50%', transform: 'translateX(-50%)', height: EAR_W, width: EAR_H, borderTop: 'none', borderRadius: '0 0 10px 10px', boxShadow: '0 3px 8px rgba(0,0,0,0.08)' },
    bottom: { ...earBase, bottom: '100%', left: '50%', transform: 'translateX(-50%)', height: EAR_W, width: EAR_H, borderBottom: 'none', borderRadius: '10px 10px 0 0', boxShadow: '0 -3px 8px rgba(0,0,0,0.08)' },
  }[pos]

  const handleStyleBase = { position: 'absolute', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border)' }
  const handleStyle = {
    left:   { ...handleStyleBase, right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize' },
    right:  { ...handleStyleBase, left: 0,  top: 0, bottom: 0, width: 6, cursor: 'col-resize' },
    top:    { ...handleStyleBase, bottom: 0, left: 0, right: 0, height: 6, cursor: 'row-resize' },
    bottom: { ...handleStyleBase, top: 0,    left: 0, right: 0, height: 6, cursor: 'row-resize' },
  }[pos]

  const dotDir = cfg.isH ? 'column' : 'row'
  const currentSize = settings.showTree ? paneSize : TAB_PX
  const noTransition = resizeDragMode || dragState.current.active
  const treeSizeStyle = cfg.isH
    ? { width: currentSize, flexShrink: 0, position: 'relative', overflow: 'visible', background: 'var(--surface)', transition: noTransition ? 'none' : 'width 0.18s cubic-bezier(0.4,0,0.2,1)', zIndex: 5 }
    : { height: currentSize, flexShrink: 0, position: 'relative', overflow: 'visible', background: 'var(--surface)', transition: noTransition ? 'none' : 'height 0.18s cubic-bezier(0.4,0,0.2,1)', zIndex: 5 }

  const treePaneEl = (
    <div style={treeSizeStyle}>
      {settings.showTree && (
        <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          <TreePane
            categories={categories} activeCategoryId={activeCategoryId}
            onSelectCategory={setActiveCategoryId} onAddCategory={addCategory}
            onRenameCategory={renameCategory} onDeleteCategory={deleteCategory}
            onReorderCategories={reorderCategories}
            nodes={nodes} loading={nodesLoading} selectedId={selectedId}
            onSelect={handleSelect} onAddBefore={handleAddBefore} onAddAfter={handleAddAfter}
            onAddChild={handleAddChild}
            onDelete={handleDelete}
            onMoveToTrash={handleMoveToTrash}
            onRestoreFromTrash={handleRestoreFromTrash}
            onUpdateTitle={updateTitle} onToggle={toggleExpanded}
            onMoveNode={handleMoveNode} onMoveNodeTo={handleMoveNodeTo}
            onMoveToCategoryBranch={handleMoveToCategoryBranch}
            onUpdateNodeStyle={updateNodeStyle}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onToast={showToast}
            settings={settings}
          />
        </div>
      )}
      {settings.showTree && (
        <div style={handleStyle} onMouseDown={onHandleMouseDown}>
          <div style={{ display: 'flex', flexDirection: dotDir, gap: 4 }}>
            {[0,1,2,3,4].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-muted)', opacity: 0.5 }} />)}
          </div>
        </div>
      )}
      {/* ─ 耳ボタン「閉」: ツリーを収納 / 長押しでドラッグ ─ */}
      {(() => {
        const offset = cfg.isH
          ? { top: 'calc(50% - 70px)', transform: 'none' }
          : { left: 'calc(50% - 70px)', transform: 'none' }
        const isActive = !settings.showTree
        return (
          <button
            style={{ ...earStyle, ...offset, background: resizeDragMode ? 'var(--accent)' : isActive ? 'var(--accent-bg)' : 'var(--surface)', color: resizeDragMode ? 'white' : isActive ? 'var(--accent)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}
            onTouchStart={onEarTouchStart} onTouchMove={onEarTouchMove} onTouchEnd={makeEarTouchEnd('close')}
            onTouchCancel={() => { clearTimeout(longPressTimer.current); setResizeDragMode(false); resizeDragModeRef.current = false; dragState.current.active = false }}
            onClick={() => {
              if (resizeDragModeRef.current) return
              updateSettings({ showTree: false })
            }}
            title="ツリーを収納（長押しでサイズ調整）"
          >
            {resizeDragMode ? (cfg.isH ? '↔' : '↕') : '閉'}
          </button>
        )
      })()}
      {/* ─ 耳ボタン「中」: 記憶した自由サイズに戻す / 長押しでドラッグ ─ */}
      {(() => {
        const offset = cfg.isH
          ? { top: 'calc(50% - 22px)', transform: 'none' }
          : { left: 'calc(50% - 22px)', transform: 'none' }
        const isActive = settings.showTree && paneSize < MAX_SIZE - 10
        return (
          <button
            style={{ ...earStyle, ...offset, background: resizeDragMode ? 'var(--accent)' : isActive ? 'var(--accent-bg)' : 'var(--surface)', color: resizeDragMode ? 'white' : isActive ? 'var(--accent)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}
            onTouchStart={onEarTouchStart} onTouchMove={onEarTouchMove} onTouchEnd={makeEarTouchEnd('mid')}
            onTouchCancel={() => { clearTimeout(longPressTimer.current); setResizeDragMode(false); resizeDragModeRef.current = false; dragState.current.active = false }}
            onClick={() => {
              if (resizeDragModeRef.current) return
              if (!settings.showTree) {
                // 収納中→自由サイズで開く
                updateSettings({ showTree: true })
              } else if (paneSize >= getMaxSize(pos) - 10) {
                // フルオープン中→記憶したサイズに戻す
                const prev = prevPaneSizeRef.current ?? 260
                setPaneSize(prev)
                updateSettings({ showTree: true, paneSize: prev })
              }
              // 自由サイズ中は何もしない（すでに「中」状態）
            }}
            title="自由サイズに戻す（長押しでサイズ調整）"
          >
            {resizeDragMode ? (cfg.isH ? '↔' : '↕') : '中'}
          </button>
        )
      })()}
      {/* ─ 耳ボタン「開」: フルオープン / 長押しでドラッグ ─ */}
      {(() => {
        const offset = cfg.isH
          ? { top: 'calc(50% + 26px)', transform: 'none' }
          : { left: 'calc(50% + 26px)', transform: 'none' }
        const isActive = settings.showTree && paneSize >= getMaxSize(pos) - 10
        return (
          <button
            style={{ ...earStyle, ...offset, background: resizeDragMode ? 'var(--accent)' : isActive ? 'var(--accent-bg)' : 'var(--surface)', color: resizeDragMode ? 'white' : isActive ? 'var(--accent)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}
            onTouchStart={onEarTouchStart} onTouchMove={onEarTouchMove} onTouchEnd={makeEarTouchEnd('open')}
            onTouchCancel={() => { clearTimeout(longPressTimer.current); setResizeDragMode(false); resizeDragModeRef.current = false; dragState.current.active = false }}
            onClick={() => {
              if (resizeDragModeRef.current) return
              // フルオープン前のサイズを記憶
              if (paneSize < getMaxSize(pos) - 10) {
                prevPaneSizeRef.current = paneSize
              }
              const ms = getMaxSize(pos); setPaneSize(ms)
              updateSettings({ showTree: true, paneSize: ms })
            }}
            title="ツリーを全開（長押しでサイズ調整）"
          >
            {resizeDragMode ? (cfg.isH ? '↔' : '↕') : '開'}
          </button>
        )
      })()}
    </div>
  )

  const editorPaneEl = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <EditorPane
        node={selectedNode} onUpdateContent={updateContent}
        onUpdateTitle={updateTitle} userId={session.user.id}
        settings={settings}
        onEmptyTrash={handleEmptyTrash}
        onTogglePublic={handleTogglePublic}
        onCopyPublicUrl={handleCopyPublicUrl}
        onOpenReminder={openReminderModal}
        onNavigateAttachment={handleNavigateAttachment}
        allNodes={nodes}
        onImportFile={handleImportFile}
        searchQuery={searchQuery}
      />
    </div>
  )

  const flexDir = cfg.isH ? 'row' : 'column'
  const [first, second] = (pos === 'left' || pos === 'top') ? [treePaneEl, editorPaneEl] : [editorPaneEl, treePaneEl]

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>NaMaMeMo</span>
          <button style={styles.versionBtn} onClick={() => setChangelogOpen(true)} title="更新履歴">
            ver.{VERSION}
          </button>
        </div>
        <div style={styles.headerRight}>
          {userIsAdmin && (
            <button style={styles.iconBtn} onClick={() => setAdminOpen(true)} title="管理者パネル" aria-label="管理者パネル">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
              </svg>
            </button>
          )}
          <button style={styles.iconBtn} onClick={() => window.location.reload()} title="リロード">
            <ReloadIcon />
          </button>

          <button style={styles.iconBtn} onClick={() => setSettingsOpen(true)} title="設定">
            <GearIcon />
          </button>
          <img src={session.user.user_metadata?.avatar_url} alt="avatar" style={styles.avatar} />
          <button style={styles.logoutBtn} onClick={() => { clearDriveTokenCache(); supabase.auth.signOut({ scope: 'local' }) }}>ログアウト</button>
        </div>
      </header>

      {updateBanner && (
        <div style={styles.updateBanner}>
          <span style={{ fontWeight: 600 }}>他の端末で更新があります</span>
          <button style={styles.updateBannerBtn} onClick={() => { setUpdateBanner(false); window.location.reload() }}>
            今すぐ反映
          </button>
          <button style={styles.updateBannerClose} onClick={() => setUpdateBanner(false)}>✕</button>
        </div>
      )}
      {!isOnline && (
        <div style={styles.offlineBadge}>🔴 オフライン</div>
      )}
      {categoriesFetchError && (
        <div style={styles.fetchErrorBanner}>
          <span style={{ fontWeight: 600 }}>⚠ データの読み込みに失敗しました</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>サーバーへの接続が不安定です。しばらく待ってから再試行してください。</span>
          <button style={styles.driveReconnectBtn} onClick={refetchCategories}>🔄 再試行する</button>
        </div>
      )}
      {driveReconnectStatus === 'needed' && isOnline && (
        <div style={styles.driveReconnectBanner}>
          <span style={{ fontWeight: 600 }}>⚠ Google Drive接続が切れています</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>
            {driveCallbackQueue.current.length > 0
              ? `${driveCallbackQueue.current.length}件の操作が再接続待ちです`
              : '操作を続けるには再接続が必要です'}
          </span>
          <button style={styles.driveReconnectBtn} onClick={triggerDriveFullAuth}>🔗 再接続する</button>
          <button style={styles.updateBannerClose} onClick={() => { setDriveReconnectStatus(null); driveCallbackQueue.current.forEach(cb => cb(null)); driveCallbackQueue.current = [] }}>✕</button>
        </div>
      )}
      {driveReconnectStatus === 'connecting' && (
        <div style={{ ...styles.driveReconnectBanner, background: 'rgba(59,130,246,0.92)' }}>
          <span style={{ fontWeight: 600 }}>⏳ Google Driveに再接続中…</span>
          <span style={{ fontSize: 12 }}>Googleの認証画面が開きます</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: flexDir, flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {first}
        {second}
      </div>

      {(migHasWork || migStats.done > 0) && (
        <DriveMigrationBar
          running={migRunning}
          current={migCurrent}
          stats={migStats}
          hasWork={migHasWork}
          pendingCount={migPending}
          onStart={startMigration}
          onStop={stopMigration}
          onRetry={retryFailed}
          onClear={clearCompleted}
        />
      )}

      {toast && <Toast message={toast} />}

      {settingsOpen && (
        <SettingsModal
          settings={settings} onUpdate={updateSettings}
          onClose={() => { setSettingsOpen(false); setPreviewTheme(null) }}
          onBackupNow={runBackup} onFetchBackupList={fetchBackupList}
          onFetchBackupAt={fetchBackupAt} onRestoreBackup={handleRestoreBackup}
          userId={session.user.id}
          onPreviewTheme={setPreviewTheme}
        />
      )}
      {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}
      {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} currentUserId={session.user.id} onRunDiagnostics={runDriveDiagnostics} />}
      {reminderModal && <ReminderModal node={reminderModal.node} onClose={() => setReminderModal(null)} />}
      {shareModal && (
        <ShareModal
          data={shareModal}
          nodes={nodes}
          userId={session.user.id}
          settings={settings}
          onClose={() => setShareModal(null)}
          onInsert={async (targetNodeId, insertHtml) => {
            const target = nodes.find(n => n.id === targetNodeId)
            if (!target) return
            setSelectedId(targetNodeId)
            saveLastSelectedId(targetNodeId)
            const newContent = insertHtml + (target.content || '<p></p>')
            await updateContent(targetNodeId, newContent)
            setShareModal(null)
            showToast('✅ 挿入完了')
          }}
        />
      )}
    </div>
  )
}

function Toast({ message }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'rgba(28,28,30,0.92)', color: 'white', padding: '8px 20px', borderRadius: 20, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 500, pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 8, backdropFilter: 'blur(8px)', whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 12, animation: 'spin 0.8s linear infinite', display: 'inline-block' }}>⟳</span>
      {message}
    </div>
  )
}

function ReloadIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  )
}
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh', background: 'var(--bg)' }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )
}

const styles = {
  app: { display: 'flex', flexDirection: 'column', height: '100dvh', position: 'fixed', inset: 0, background: 'var(--bg)', color: 'var(--text)', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 48, flexShrink: 0, background: 'var(--header-bg)', color: 'var(--header-text)', position: 'relative', zIndex: 10 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 6 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 6 },
  logo: { fontSize: 15, fontWeight: 700 },
  versionBtn: { background: 'none', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4, color: 'rgba(255,255,255,0.65)', fontSize: 10, padding: '2px 6px', cursor: 'pointer', letterSpacing: '0.02em' },
  iconBtn: { background: 'none', border: 'none', color: 'var(--header-text)', width: 32, height: 32, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 },
  avatar: { width: 26, height: 26, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)' },
  logoutBtn: { padding: '3px 10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, color: 'var(--header-text)', cursor: 'pointer', fontSize: 12 },
  updateBanner: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 14px', flexShrink: 0, zIndex: 9, color: 'white', fontSize: 13,
    background: 'linear-gradient(270deg, #5b6af0, #9b4dca, #e06020, #38a169, #3182ce, #5b6af0)',
    backgroundSize: '400% 400%', animation: 'gradientShift 4s ease infinite',
  },
  updateBannerBtn: { padding: '3px 14px', background: 'white', color: '#1a1a1a', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 700, marginLeft: 'auto' },
  updateBannerClose: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: 16, padding: '2px 4px' },
  offlineBadge: { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', padding: '6px 18px', background: 'rgba(30,30,30,0.82)', color: 'white', borderRadius: 20, fontSize: 12, fontWeight: 600, zIndex: 999, pointerEvents: 'none', backdropFilter: 'blur(6px)', letterSpacing: '0.03em' },
  fetchErrorBanner: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', background: 'rgba(180,90,0,0.92)', color: 'white', fontSize: 13, flexShrink: 0, zIndex: 10 },
  driveReconnectBanner: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', background: 'rgba(220,80,30,0.92)', color: 'white', fontSize: 13, flexShrink: 0, zIndex: 10 },
  driveReconnectBtn: { padding: '4px 14px', background: 'white', color: '#c02000', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 700, marginLeft: 'auto', whiteSpace: 'nowrap' },
}
