import { useState, useEffect, useRef, useCallback } from 'react'
import { ALL_TOOLBAR_ITEMS, THEMES, THEME_ROWS, MAX_DB_MB, MAX_STORAGE_MB } from '../hooks/useSettings'
import { supabase } from '../supabaseClient'
import { useDialog } from './DialogProvider'

const POSITION_OPTIONS = [
  { value: 'left', label: '左', icon: '▐' },
  { value: 'right', label: '右', icon: '▌' },
  { value: 'top', label: '上', icon: '▄' },
  { value: 'bottom', label: '下', icon: '▀' },
]

export default function SettingsModal({
  settings, onUpdate, onClose,
  onBackupNow, onFetchBackupList, onFetchBackupAt, onRestoreBackup,
  userId, onPreviewTheme,
}) {
  const { confirm } = useDialog()
  const [localSettings, setLocalSettings] = useState(settings)
  const [tab, setTab] = useState('general')
  const [backupList, setBackupList] = useState([])
  const [backupLoading, setBackupLoading] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState(null)
  const [dbUsed, setDbUsed] = useState(null)
  const [storageUsed, setStorageUsed] = useState(null)

  // 起動時にSupabaseから最新のニックネームを取得してlocalSettingsに反映
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const actualNickname = user?.user_metadata?.nickname
      if (actualNickname && actualNickname !== localSettings.nickname) {
        setLocalSettings(prev => ({ ...prev, nickname: actualNickname }))
      }
    }).catch(() => {})
  }, [])

  const patch = (key, value) => setLocalSettings(prev => ({ ...prev, [key]: value }))
  // ★ 複数項目を同時に更新するための関数を追加
  const updateMultipleSettings = (updates) => setLocalSettings(prev => ({ ...prev, ...updates }))

  const handleSave = () => {
    onUpdate(localSettings)
    onPreviewTheme(null)
    onClose()
    // ニックネームを Supabase ユーザーメタデータにも保存（管理者パネル参照用）
    if (localSettings.nickname !== undefined) {
      supabase.auth.updateUser({ data: { nickname: localSettings.nickname } }).catch(() => {})
    }
  }
  const handleCancel = () => {
    onPreviewTheme(null)
    onClose()
  }

  const handleThemeSelect = (key) => {
    patch('theme', key)
    onPreviewTheme(key)
  }

  // DB容量計算
  useEffect(() => {
    if (tab !== 'general' || !userId) return
    const calc = async () => {
      const { data: nodes } = await supabase.from('nodes').select('content, title').eq('user_id', userId)
      const textBytes = (nodes || []).reduce((sum, n) => sum + (n.content?.length || 0) + (n.title?.length || 0), 0)
      setDbUsed(textBytes / 1024 / 1024)

      // ストレージ使用量（images バケットのファイル一覧）
      try {
        const { data: files } = await supabase.storage.from('images').list(userId)
        if (files) {
          // サイズを合算（Supabase Storageのlistはmetadataにsizeがある）
          let totalBytes = 0
          for (const f of files) {
            totalBytes += f.metadata?.size || 0
          }
          setStorageUsed(totalBytes / 1024 / 1024)
        }
      } catch {
        setStorageUsed(null)
      }
    }
    calc()
  }, [tab, userId])

  const handleBackupNow = async () => {
    setBackingUp(true)
    const done = await onBackupNow(true)
    setBackingUp(false)
    setBackupMsg(done ? '✅ 完了！' : '変更なし（スキップ）')
    setTimeout(() => setBackupMsg(''), 3000)
    loadBackupList()
  }

  const loadBackupList = async () => {
    setBackupLoading(true)
    const list = await onFetchBackupList()
    setBackupList(list)
    setBackupLoading(false)
  }

  useEffect(() => { if (tab === 'backup') loadBackupList() }, [tab])

  const handleRestore = async () => {
    if (!selectedBackup) return
    if (!await confirm('このバックアップを復元しますか？\n現在のデータは上書きされます。')) return
    setRestoring(true)
    const backupNodes = await onFetchBackupAt(selectedBackup)
    await onRestoreBackup(backupNodes)
    setRestoring(false)
    onClose()
  }

  const formatDate = (iso) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const TABS = [['general','一般'],['display','表示'],['editor','編集機能'],['backup','バックアップ']]

  const enabledIds = Array.isArray(localSettings.enabledToolbarItems)
    ? localSettings.enabledToolbarItems.map(i => typeof i === 'string' ? i : i.id)
    : ALL_TOOLBAR_ITEMS.map(i => i.id)

  const overlayMouseDownTarget = useRef(null)

  return (
    <div
      style={styles.overlay}
      onMouseDown={e => { overlayMouseDownTarget.current = e.target }}
      onClick={e => {
        // mousedownとmouseupが両方overlayそのものの時だけ閉じる（ドラッグ終点がoverlay外でも閉じない）
        if (e.target === e.currentTarget && overlayMouseDownTarget.current === e.currentTarget) {
          handleCancel()
        }
        overlayMouseDownTarget.current = null
      }}
    >
      <div style={styles.modal} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>⚙️ 設定</h2>
          <button style={styles.closeBtn} onClick={handleCancel}>✕</button>
        </div>

        <div style={styles.tabs}>
          {TABS.map(([key, label]) => (
            <button key={key} style={{
              ...styles.tab,
              borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === key ? 'var(--accent)' : 'var(--text-muted)',
            }} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        <div style={styles.body}>

          {/* ── 一般 ── */}
          {tab === 'general' && (
            <>
              <Section title="ツリーの位置">
                <div style={styles.positionGrid}>
                  {POSITION_OPTIONS.map(opt => (
                    <button key={opt.value} style={{
                      ...styles.posBtn,
                      background: localSettings.treePosition === opt.value ? 'var(--accent)' : 'var(--surface)',
                      color: localSettings.treePosition === opt.value ? 'white' : 'var(--text)',
                      border: `2px solid ${localSettings.treePosition === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                    }} onClick={() => patch('treePosition', opt.value)}>
                      <span style={{ fontSize: 20 }}>{opt.icon}</span>
                      <span style={{ fontSize: 12 }}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="ごみ箱">
                <label style={styles.toggleRow}>
                  <span>ごみ箱ノードを非表示にする</span>
                  <Toggle value={localSettings.hideTrash ?? false} onChange={v => patch('hideTrash', v)} />
                </label>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  ※ 非表示にしても、ごみ箱に入ったノードは削除されません。
                </p>
              </Section>

              {/* ★ Google Drive設定セクションを追加 */}
              <Section title="外部ストレージ連携">
                <GoogleDriveSettings settings={localSettings} updateSettings={updateMultipleSettings} />
              </Section>

              <Section title="ニックネーム">
                <NicknameEditor value={localSettings.nickname || ''} onChange={v => patch('nickname', v)} />
              </Section>

              <Section title="容量使用状況">
                {/* DBテキスト容量 */}
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>データベース（テキスト）</p>
                  {dbUsed !== null ? (
                    <div>
                      <div style={styles.storageBarBg}>
                        <div style={{ ...styles.storageBarFill, width: `${Math.min(100,(dbUsed/MAX_DB_MB)*100)}%`, background: dbUsed/MAX_DB_MB > 0.8 ? '#e53e3e' : 'var(--accent)' }} />
                      </div>
                      <div style={styles.storageText}>
                        <span>{dbUsed.toFixed(2)} MB / {MAX_DB_MB} MB</span>
                        <span style={{ color: 'var(--text-muted)' }}>({((dbUsed/MAX_DB_MB)*100).toFixed(1)}%)</span>
                      </div>
                    </div>
                  ) : <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>計算中…</p>}
                </div>

                {/* ストレージ（画像）容量 */}
                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>ストレージ（画像）</p>
                  {storageUsed !== null ? (
                    <div>
                      <div style={styles.storageBarBg}>
                        <div style={{ ...styles.storageBarFill, width: `${Math.min(100,(storageUsed/MAX_STORAGE_MB)*100)}%`, background: storageUsed/MAX_STORAGE_MB > 0.8 ? '#e53e3e' : '#38a169' }} />
                      </div>
                      <div style={styles.storageText}>
                        <span>{storageUsed.toFixed(2)} MB / {MAX_STORAGE_MB} MB</span>
                        <span style={{ color: 'var(--text-muted)' }}>({((storageUsed/MAX_STORAGE_MB)*100).toFixed(1)}%)</span>
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {dbUsed !== null ? '取得できませんでした' : '計算中…'}
                    </p>
                  )}
                </div>
              </Section>
            </>
          )}

          {/* ── 表示 ── */}
          {tab === 'display' && (
            <>
              <Section title="テーマカラー">
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>選択すると画面全体でプレビューできます。保存で確定します。</p>
                {THEME_ROWS.map((row, rowIdx) => (
                  <div key={rowIdx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    {row.map(key => {
                      const theme = THEMES[key]
                      const isSelected = localSettings.theme === key
                      return (
                        <button key={key} style={{
                          ...styles.themeBtn,
                          border: `2px solid ${isSelected ? 'var(--accent)' : theme.vars['--border']}`,
                          background: theme.vars['--bg'],
                          flex: 1,
                        }} onClick={() => handleThemeSelect(key)}>
                          <div style={{ display: 'flex', gap: 3, marginBottom: 4, justifyContent: 'center' }}>
                            {['--accent','--text','--surface'].map(v => (
                              <div key={v} style={{ width: 10, height: 10, borderRadius: '50%', background: theme.vars[v], border: `1px solid ${theme.vars['--border']}` }} />
                            ))}
                          </div>
                          <span style={{ fontSize: 9, color: theme.vars['--text'], fontWeight: 600, lineHeight: 1.2, textAlign: 'center' }}>{theme.name}</span>
                          {isSelected && <span style={{ position: 'absolute', top: 3, right: 3, fontSize: 9 }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </Section>

              <Section title="デフォルトフォントサイズ">
                <div style={styles.sliderRow}>
                  <span style={styles.sliderLabel}>10px</span>
                  <ValueSlider min={10} max={24} step={1}
                    value={localSettings.defaultFontSize || 15}
                    display={`${localSettings.defaultFontSize || 15}px`}
                    onChange={v => patch('defaultFontSize', v)} />
                </div>
              </Section>

              <Section title="本文の行間">
                <div style={styles.sliderRow}>
                  <span style={styles.sliderLabel}>1.0</span>
                  <ValueSlider min={10} max={30} step={1}
                    value={Math.round((localSettings.lineHeight || 1.6) * 10)}
                    display={(localSettings.lineHeight || 1.6).toFixed(1)}
                    onChange={v => patch('lineHeight', v / 10)} />
                </div>
              </Section>

              <Section title="ノードの行間">
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                  左ペインのノード高さを調整します。狭めるとより多くのノードを表示できます。
                </p>
                <div style={styles.sliderRow}>
                  <span style={styles.sliderLabel}>0.8</span>
                  <ValueSlider min={8} max={24} step={1}
                    value={Math.round((localSettings.nodeLineHeight ?? 1.4) * 10)}
                    display={(localSettings.nodeLineHeight ?? 1.4).toFixed(1)}
                    onChange={v => patch('nodeLineHeight', v / 10)} />
                </div>
                <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  {['ノードA（選択中）', 'ノードB', 'ノードC'].map((n, i) => (
                    <div key={i} style={{
                      fontSize: 13,
                      color: i === 0 ? 'var(--accent)' : 'var(--text)',
                      background: i === 0 ? 'var(--accent-bg)' : 'transparent',
                      padding: `${Math.round(((localSettings.nodeLineHeight ?? 1.4) - 0.8) * 10)}px 8px`,
                      borderRadius: 4, marginBottom: 2,
                    }}>{n}</div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* ── 編集機能 ── */}
          {tab === 'editor' && (
            <>
              <Section title="文字数カウント">
                <label style={styles.toggleRow}>
                  <span>エディタ下部に文字数・単語数を表示</span>
                  <Toggle value={localSettings.showCharCount ?? false} onChange={v => patch('showCharCount', v)} />
                </label>
              </Section>
              <ToolbarEditor
                allItems={ALL_TOOLBAR_ITEMS}
                enabledIds={enabledIds}
                onChange={ids => patch('enabledToolbarItems', ids)}
              />
            </>
          )}

          {/* ── バックアップ ── */}
          {tab === 'backup' && (
            <>
              <Section title="自動バックアップ設定">
                <label style={styles.toggleRow}>
                  <span>自動バックアップを有効にする</span>
                  <Toggle value={localSettings.autoBackup} onChange={v => patch('autoBackup', v)} />
                </label>
                {localSettings.autoBackup && (
                  <div style={styles.backupOptions}>
                    <label style={styles.inputRow}>
                      <span style={styles.inputLabel}>バックアップ間隔</span>
                      <div style={styles.inputGroup}>
                        <input type="number" min={1} max={60} value={localSettings.backupIntervalMin}
                          onChange={e => patch('backupIntervalMin', Number(e.target.value))} style={styles.numInput} />
                        <span style={styles.inputUnit}>分ごと</span>
                      </div>
                    </label>
                    <label style={styles.inputRow}>
                      <span style={styles.inputLabel}>保存件数の上限</span>
                      <div style={styles.inputGroup}>
                        <input type="number" min={1} max={100} value={localSettings.backupMaxCount}
                          onChange={e => patch('backupMaxCount', Number(e.target.value))} style={styles.numInput} />
                        <span style={styles.inputUnit}>件まで</span>
                      </div>
                    </label>
                  </div>
                )}
                <button style={styles.backupNowBtn} onClick={handleBackupNow} disabled={backingUp}>
                  {backingUp ? '保存中…' : backupMsg || '今すぐバックアップ'}
                </button>
              </Section>
              <Section title="バックアップ一覧">
                {backupLoading ? <p style={styles.emptyMsg}>読み込み中…</p>
                  : backupList.length === 0 ? <p style={styles.emptyMsg}>バックアップがありません</p>
                  : (
                    <div style={styles.backupList}>
                      {backupList.map(iso => (
                        <button key={iso} onClick={() => setSelectedBackup(iso)} style={{
                          ...styles.backupItem,
                          background: selectedBackup === iso ? 'var(--accent-bg)' : 'var(--surface)',
                          border: `1px solid ${selectedBackup === iso ? 'var(--accent)' : 'var(--border)'}`,
                          color: selectedBackup === iso ? 'var(--accent)' : 'var(--text)',
                        }}>{formatDate(iso)}</button>
                      ))}
                    </div>
                  )}
                {selectedBackup && (
                  <button style={styles.restoreBtn} onClick={handleRestore} disabled={restoring}>
                    {restoring ? '復元中…' : '↩ このバックアップを復元'}
                  </button>
                )}
              </Section>
            </>
          )}
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={handleCancel}>キャンセル</button>
          <button style={styles.saveBtn} onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  )
}

// ── Google Drive 連携コンポーネント ──
function GoogleDriveSettings({ settings, updateSettings }) {
  // Drive連携は常時有効。状態表示と手動再接続ボタンのみ提供
  const hasToken = !!settings?.googleDriveToken
  const tokenExpiry = settings?.googleDriveTokenExpiry
  const hasRefreshToken = !!settings?.googleProviderRefreshToken

  const tokenStatus = (() => {
    if (!hasToken) return { ok: false, label: 'トークンなし（Edge Functionで自動取得）' }
    if (!tokenExpiry) return { ok: true, label: '有効（期限不明）' }
    const rem = tokenExpiry - Date.now()
    if (rem <= 0) return { ok: false, label: '期限切れ（次回操作時に自動更新）' }
    const mins = Math.round(rem / 60000)
    return { ok: true, label: `有効（あと約 ${mins} 分）` }
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Google Drive連携</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        ログイン時にDrive連携が自動的に有効になります。画像・ファイルの添付にはDrive接続が必要です。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>アクセストークン</span>
          <span style={{ color: tokenStatus.ok ? '#16a34a' : 'var(--text-muted)', fontWeight: 600 }}>
            {tokenStatus.ok ? '✅' : '⚪'} {tokenStatus.label}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>自動更新（Edge Function）</span>
          <span style={{ color: hasRefreshToken ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
            {hasRefreshToken ? '✅ 利用可能' : '❌ 未取得（再ログイン推奨）'}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, padding: '0 2px' }}>
        接続が切れた場合はアプリ上部に「Drive再接続」バナーが自動表示されます。バナーの「再接続する」を押すとログイン中のGoogleアカウントで再認証されます。
      </div>
    </div>
  )
}

const gdStyles = {}

// ── 現在値を四角いハンドルの中に表示するスライダー ──
function ValueSlider({ min, max, step, value, display, onChange }) {
  const ratio = max > min ? (value - min) / (max - min) : 0
  return (
    <div style={{ position: 'relative', flex: 1, height: 26, display: 'flex', alignItems: 'center' }}>
      <input type="range" className="value-slider" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))} />
      <span style={{
        position: 'absolute', top: '50%',
        left: `calc(18px + (100% - 36px) * ${ratio})`,
        transform: 'translate(-50%, -50%)',
        fontSize: 11, fontWeight: 700, color: '#fff',
        textShadow: '0 0 3px rgba(0,0,0,0.4)',
        pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>{display}</span>
    </div>
  )
}

// ── 編集機能の取捨選択UI ──
function ToolbarEditor({ allItems, enabledIds, onChange }) {
  const [enabled, setEnabled] = useState(() => {
    return enabledIds.filter(id => allItems.some(item => item.id === id))
  })

  const disabled = allItems.filter(item => !enabled.includes(item.id))

  useEffect(() => { onChange(enabled) }, [enabled])

  const addItem = (id) => {
    setEnabled(prev => prev.includes(id) ? prev : [...prev, id])
  }
  const removeItem = (id) => {
    setEnabled(prev => prev.filter(x => x !== id))
  }

  const itemRefs = useRef([])
  const draggingRef = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  const onHandleDown = useCallback((e, idx) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = idx
    setDragOverIdx(idx)
  }, [])

  const onHandleMove = useCallback((e) => {
    if (draggingRef.current === null) return
    const y = e.clientY
    let found = draggingRef.current
    itemRefs.current.forEach((el, i) => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (y >= rect.top && y <= rect.bottom) found = i
    })
    setDragOverIdx(found)
  }, [])

  const onHandleUp = useCallback(() => {
    const from = draggingRef.current, to = dragOverIdx
    draggingRef.current = null
    setDragOverIdx(null)
    if (from === null || to === null || from === to) return
    setEnabled(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [dragOverIdx])

  const getLabel = (id) => allItems.find(i => i.id === id)?.label || id
  const getIcon = (id) => allItems.find(i => i.id === id)?.icon || ''

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 520
  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
      <div style={styles.editorColumn}>
        <div style={styles.editorColumnTitle}>使わない機能</div>
        <div style={styles.editorList}>
          {disabled.map(item => (
            <div key={item.id} style={styles.editorItem}>
              <span style={styles.editorItemIcon}>{item.icon || ''}</span>
              <span style={styles.editorItemLabel}>{item.label}</span>
              <button style={styles.editorMoveBtn} onClick={() => addItem(item.id)} title="追加">→</button>
            </div>
          ))}
          {disabled.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>（なし）</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', fontSize: 18 }}>
        {isMobile ? '↕' : '⇄'}
      </div>

      <div style={styles.editorColumn}>
        <div style={styles.editorColumnTitle}>使う機能（上から表示順）</div>
        <div style={styles.editorList}>
          {enabled.map((id, idx) => (
            <div
              key={id}
              ref={el => itemRefs.current[idx] = el}
              style={{
                ...styles.editorItem,
                background: dragOverIdx === idx ? 'var(--accent-bg)' : 'var(--surface)',
                borderTop: dragOverIdx === idx && draggingRef.current !== idx ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <span
                style={styles.editorDragHandle}
                onPointerDown={e => onHandleDown(e, idx)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={() => { draggingRef.current = null; setDragOverIdx(null) }}
              >⠿</span>
              <span style={styles.editorItemIcon}>{getIcon(id)}</span>
              <span style={styles.editorItemLabel}>{getLabel(id)}</span>
              <button style={{ ...styles.editorMoveBtn, color: '#e53e3e' }} onClick={() => removeItem(id)} title="削除">←</button>
            </div>
          ))}
          {enabled.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>（なし）</div>
          )}
        </div>
      </div>
    </div>
  )
}

function NicknameEditor({ value, onChange }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)
    try {
      await supabase.auth.updateUser({ data: { nickname: value.trim() } })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
    setSaving(false)
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value.slice(0, 20)); setSaved(false) }}
          maxLength={20}
          placeholder="ニックネームを入力"
          style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, background: 'var(--bg)', color: 'var(--text)', outline: 'none' }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          style={{ padding: '8px 14px', background: saved ? '#38a169' : 'var(--accent)', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', opacity: !value.trim() ? 0.5 : 1 }}
        >
          {saving ? '…' : saved ? '✅ 保存済' : '保存'}
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>管理者パネルで識別に使われます（最大20文字）</p>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>{title}</p>
      {children}
    </div>
  )
}
function Toggle({ value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', background: value ? 'var(--accent)' : 'var(--border)', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
      <span style={{ position: 'absolute', top: 2, left: value ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </button>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--bg)', borderRadius: 16, width: 500, maxWidth: '92vw', height: 'min(85vh, 680px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 12px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 17, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--text-muted)', width: 28, height: 28, borderRadius: 6 },
  tabs: { display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 20px', overflowX: 'auto' },
  tab: { padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'color 0.15s', whiteSpace: 'nowrap' },
  body: { flex: 1, overflowY: 'auto', padding: '20px 20px 8px' },
  positionGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 },
  posBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 0', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s' },
  storageBarBg: { height: 10, background: 'var(--border)', borderRadius: 5, overflow: 'hidden', marginBottom: 6 },
  storageBarFill: { height: '100%', borderRadius: 5, transition: 'width 0.5s' },
  storageText: { display: 'flex', gap: 8, fontSize: 12, color: 'var(--text)' },
  themeBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 6px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s', position: 'relative', minWidth: 0 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 10 },
  sliderLabel: { fontSize: 12, color: 'var(--text-muted)', minWidth: 32, textAlign: 'center' },
  editorColumn: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  editorColumnTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  editorList: { border: '1px solid var(--border)', borderRadius: 8, overflowY: 'auto', minHeight: 60, maxHeight: 200, background: 'var(--surface)' },
  editorItem: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: '1px solid var(--border)' },
  editorDragHandle: { fontSize: 16, color: 'var(--text-muted)', cursor: 'grab', flexShrink: 0, touchAction: 'none', userSelect: 'none', padding: '2px 4px', lineHeight: 1 },
  editorItemLabel: { flex: 1, fontSize: 13, color: 'var(--text)' },
  editorItemIcon: { width: 24, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)', flexShrink: 0 },
  editorMoveBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 8px', borderRadius: 4, color: 'var(--accent)', fontWeight: 700 },
  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, color: 'var(--text)', cursor: 'pointer', marginBottom: 12 },
  backupOptions: { background: 'var(--surface)', borderRadius: 10, padding: '12px 14px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  inputRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: 'var(--text)' },
  inputLabel: { flex: 1 },
  inputGroup: { display: 'flex', alignItems: 'center', gap: 6 },
  numInput: { width: 56, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, textAlign: 'right', background: 'var(--bg)', color: 'var(--text)' },
  inputUnit: { fontSize: 12, color: 'var(--text-muted)' },
  backupNowBtn: { width: '100%', padding: '8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text)' },
  emptyMsg: { color: 'var(--text-muted)', fontSize: 13 },
  backupList: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', marginBottom: 8 },
  backupItem: { padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, textAlign: 'left', transition: 'all 0.1s' },
  restoreBtn: { marginTop: 4, width: '100%', padding: '10px', background: 'var(--accent)', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: 'white', fontWeight: 600 },
  footer: { display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)', justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text)' },
  saveBtn: { padding: '8px 20px', background: 'var(--accent)', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: 'white', fontWeight: 600 },
}
