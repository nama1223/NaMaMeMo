import { useState, useEffect, useRef, useCallback } from 'react'

const STORAGE_KEY = 'namamemo_settings'

export const ALL_TOOLBAR_ITEMS = [
  { id: 'fontSize',    label: 'フォントサイズ' },
  { id: 'undo',        label: '元に戻す' },
  { id: 'redo',        label: 'やり直し' },
  { id: 'heading',     label: '見出し（H1〜H4）' },
  { id: 'bold',        label: '太字' },
  { id: 'italic',      label: '斜体' },
  { id: 'underline',   label: '下線' },
  { id: 'strike',      label: '取り消し線' },
  { id: 'color',       label: '文字色' },
  { id: 'highlight',   label: 'ハイライト' },
  { id: 'align',       label: '文字揃え' },
  { id: 'bulletList',  label: '箇条書き' },
  { id: 'orderedList', label: '番号付きリスト' },
  { id: 'taskList',    label: 'チェックボックス' },
  { id: 'blockquote',  label: '引用' },
  { id: 'codeBlock',   label: 'コードブロック' },
  { id: 'details', label: '折りたたみ' },
  { id: 'image', label: '画像・音声挿入' },
  { id: 'share',    label: 'Webに公開する' },
  { id: 'font',     label: 'フォント選択' },
  { id: 'home',     label: 'ホーム画面に追加（🏠）' },
  { id: 'reminder', label: 'リマインダー（⏰）' },
  { id: 'export',   label: 'エクスポート（out）' },
  { id: 'import',   label: 'インポート（in）' },
  { id: 'link',     label: 'リンク' },
  { id: 'table',    label: 'テーブル' },
  { id: 'youtube',  label: 'YouTube埋め込み' },
  { id: 'childrenSummary', label: '子孫まとめ表示（📋）' },
  { id: 'tableOfContents', label: '目次（≡）' },
]

const DEFAULT_ENABLED_ITEMS = ALL_TOOLBAR_ITEMS.map(i => i.id)

// ライト系（行1）、ダーク系（行2）の6種
export const THEMES = {
  // ── ライト系 ──
  light: {
    name: 'ライト',
    row: 1,
    vars: {
      '--bg': '#ffffff', '--surface': '#f7f7f8', '--border': '#e5e5e7',
      '--text': '#1a1a1a', '--text-muted': '#8e8e93',
      '--accent': '#5b6af0', '--accent-bg': '#eff1fe',
      '--header-bg': '#1c1c1e', '--header-text': '#ffffff',
    },
  },
  forest: {
    name: 'フォレスト',
    row: 1,
    vars: {
      '--bg': '#f0f7f0', '--surface': '#e0f0e0', '--border': '#a8d0a8',
      '--text': '#1a3a1a', '--text-muted': '#4a7a4a',
      '--accent': '#2d7a2d', '--accent-bg': '#c8e8c8',
      '--header-bg': '#1a3a1a', '--header-text': '#ffffff',
    },
  },
  sunset: {
    name: 'サンセット',
    row: 1,
    vars: {
      '--bg': '#fff8f0', '--surface': '#fdf0e0', '--border': '#f0d0b0',
      '--text': '#3a1a0a', '--text-muted': '#9a5a3a',
      '--accent': '#e06020', '--accent-bg': '#fde8d0',
      '--header-bg': '#3a1a0a', '--header-text': '#fff8f0',
    },
  },
  // ── ダーク系 ──
  dark: {
    name: 'ダーク',
    row: 2,
    vars: {
      '--bg': '#1c1c1e', '--surface': '#2c2c2e', '--border': '#3a3a3c',
      '--text': '#f2f2f7', '--text-muted': '#8e8e93',
      '--accent': '#7b8ef7', '--accent-bg': '#2a2d5a',
      '--header-bg': '#000000', '--header-text': '#f2f2f7',
    },
  },
  midnight: {
    name: 'ミッドナイト',
    row: 2,
    vars: {
      '--bg': '#0a0f1e', '--surface': '#111827', '--border': '#1f2d4a',
      '--text': '#d0d8f0', '--text-muted': '#5a6a8a',
      '--accent': '#4488ff', '--accent-bg': '#0a1840',
      '--header-bg': '#050a14', '--header-text': '#8ab4ff',
    },
  },
  wabisabi: {
    name: '侘び寂び',
    row: 2,
    vars: {
      '--bg': '#161210', '--surface': '#1e1a18', '--border': '#2e2824',
      '--text': '#b8a898', '--text-muted': '#6a5a50',
      '--accent': '#b07848', '--accent-bg': '#281e18',
      '--header-bg': '#0c0a08', '--header-text': '#c8a880',
    },
  },
}

// 行ごとの表示順
export const THEME_ROWS = [
  Object.entries(THEMES).filter(([,t]) => t.row === 1).map(([k]) => k),
  Object.entries(THEMES).filter(([,t]) => t.row === 2).map(([k]) => k),
]

// 容量制限
export const MAX_DB_MB = 10      // データベース最大容量 (MB)
export const MAX_STORAGE_MB = 20 // ストレージ最大容量 (MB)
export const MAX_LOGIN_COUNT = 50 // 最大ログイン数

const defaultSettings = {
  treePosition: 'left',
  autoBackup: true,
  backupIntervalMin: 5,
  backupMaxCount: 20,
  paneSize: 260,
  theme: 'light',
  defaultFontSize: 15,
  lineHeight: 1.6,
  nodeLineHeight: 1.4,
  lockOrientation: false,
  enabledToolbarItems: DEFAULT_ENABLED_ITEMS,
  hideTrash: false,
  showTree: true,
  showCharCount: false,
}

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return defaultSettings
      const parsed = JSON.parse(saved)
      // enabledToolbarItems が古いオブジェクト配列形式の場合に正規化
      if (Array.isArray(parsed.enabledToolbarItems) && parsed.enabledToolbarItems.length > 0 && typeof parsed.enabledToolbarItems[0] === 'object') {
        parsed.enabledToolbarItems = parsed.enabledToolbarItems.map(i => i?.id || i).filter(Boolean)
      }
      // 廃止テーマを置き換え
      const obsoleteThemes = ['gaming', 'sepia', 'ocean', 'midnightBlue', 'shibui']
      if (parsed.theme && obsoleteThemes.includes(parsed.theme)) {
        const map = { gaming: 'midnight', midnightBlue: 'midnight', shibui: 'wabisabi', sepia: 'light', ocean: 'dark' }
        parsed.theme = map[parsed.theme] || 'light'
      }
      return { ...defaultSettings, ...parsed }
    } catch {
      return defaultSettings
    }
  })

  // 初回レンダリング時は書き込みをスキップ（PWAの複数インスタンス競合を防ぐ）
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    // ── デバッグ：書き込みをlocalStorageのログに記録 ──
    try {
      const trace = new Error().stack || 'no stack'
      const entry = {
        t: new Date().toISOString(),
        treePosition: settings.treePosition,
        enabledCount: settings.enabledToolbarItems?.length,
        stack: trace.split('\n').slice(1, 5).join(' | '),
      }
      const prev = JSON.parse(localStorage.getItem('namamemo_settings_log') || '[]')
      prev.push(entry)
      localStorage.setItem('namamemo_settings_log', JSON.stringify(prev.slice(-30)))
    } catch {}
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const updateSettings = useCallback((patch) => {
    setSettings(prev => ({ ...prev, ...patch }))
  }, [])
  return { settings, updateSettings }
}
