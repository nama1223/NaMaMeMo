export const VERSION = '1.03'

export const CHANGELOG = [
  {
    version: '1.03',
    date: '2026-11-10',
    items: [
      '起動：電波の弱い場所で通信が宙吊りになるとメモが表示されなかった問題を修正（認証・カテゴリ・メモ取得にタイムアウトを追加し、端末内キャッシュで表示を続行するよう改善）',
    ],
  },
  {
    version: '1.02',
    date: '2026-05-14',
    items: [
      'Google Drive連携：Supabase Edge Functionによりトークンを完全自動更新。24時間放置後でも再ログイン不要',
      'Google Drive連携：ログイン時にリフレッシュトークンを保存し、Edge Functionのフォールバックとして活用',
      'Google Drive連携：全Drive操作（画像・音声・動画・PDF・インポート移設）に再接続チェックを統合',
      '管理者パネル：Drive連携診断ツールを追加（全チェック項目を現在のメモに書き出す）',
      'ログイン：リフレッシュトークン取得済みの場合は通常ログイン画面に戻す（毎回の同意画面を廃止）',
    ],
  },
  {
    version: '1.01',
    date: '2026-05-09',
    items: [
      '管理者パネル：全ユーザーのデータを表示できるよう修正（RLS バイパス用 RPC 追加）',
      '管理者パネル：ユーザー数カウントを修正（ログイン画面と一致するように）',
      '設定モーダル：「編集機能」項目の先頭についていた ≡ マークを削除',
      'PWA：サービスワーカー更新時の無限リロードループを修正',
      'Supabase 認証：onAuthStateChange コールバック内での非同期処理によるデッドロック（5000ms ロック）を修正',
      'エディタ：Tiptap v3 で Link 拡張が重複登録される警告を修正',
    ],
  },
  {
    version: '0.98',
    date: '2026-04-25',
    items: [
      '動画添付対応：サムネイル自動抽出・Google Drive保存・プログレスバー付きアップロード',
      'フォント選択機能：ツールバーにFontポップオーバーを追加（7書体対応）',
      '文字色・ハイライト・文字揃えをポップオーバー式に圧縮、色の選択肢を3倍に増加（淡色系追加）',
      '公開機能のUIを改善：🔒/🌐タップで操作メニューが展開する形式に変更',
      'ノード行間スライダーを設定に追加（プレビュー付き）',
      'ツールバーに🏠ショートカット・⏰リマインダーボタンを追加',
      '添付ファイル「別ノードに移動」モーダルをツリー順・階層インデント付き表示に改善、移動先の先頭に挿入',
      '動画のコンテキストメニューに「このノード内で移動」を追加',
      'リマインダー：通知本文にノードタイトルを表示、タップでそのノードを直接開く',
      'Google Drive連携を即時保存に変更（保存ボタン不要、事故防止）',
    ],
  },
  {
    version: '0.90-0.95',
    date: '2026-04-18',
    items: [
      '複数のバグが全然直らなかったのでGeminiさんに相談して大量の手動修正(ここも手動で書いている)',
      '機能追加：Google Drive連携、音声添付、検索、ノード装飾、ノードWeb共有',
    ],
  },
  {
    version: '0.89',
    date: '2026-04-10',
    items: [
      '選択維持: chain().focus()を呼ばずにコマンド実行→選択が消える根本原因を修正',
      '選択維持: sl()関数をfocusなしのsetTextSelection復元方式に変更',
      'フォントサイズ入力: 開く前に選択範囲をRefに保存、適用時に復元する方式に変更',
      'チェックボックス: font-size:inherit!important でem基準をliのフォントサイズに強制連動',
      'チェックボックス: セレクタを > で厳密にし、ネスト構造に確実に当たるよう修正',
      '折りたたみ: dom.open=!!attrs.open で初期値を確実に設定（closedの修正）',
      'スマホD&D: ref を毎レンダリング更新方式に変更（useEffect遅延を排除）',
      'スマホD&D: onTouchEnd/onPointerUp が常に最新のendDragを呼ぶことを保証',
      '容量削減: 元画像をStorage.remove()で削除（URL→pathの抽出ロジックを修正）',
      '画像移動メニュー「未対応」表示を削除し、移動メニューはファイルのみに明確化',
    ],
  },
  {
    version: '0.88',
    date: '2026-04-10',
    items: [
      '選択維持・フォントサイズ入力・折りたたみ・カーソルワープ修正（途中版）',
      '容量削減で元画像削除を追加（パス抽出に問題あり→0.89で修正）',
    ],
  },
  {
    version: '0.87',
    date: '2026-04-10',
    items: [
      'チェックボックスCSS・D&Dstale closure修正・折りたたみネイティブ方式',
    ],
  },
  {
    version: '0.84',
    date: '2026-04-10',
    items: [
      '100dvh統一・折りたたみ・画像容量削減・ごみ箱機能',
    ],
  },
  {
    version: '0.80',
    date: '2026-04-08',
    items: [
      'カテゴリ・リアルタイム同期・ファイルD&D追加',
    ],
  },
]

export default function ChangelogModal({ onClose }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>📝 NaMaMeMo 更新履歴</h2>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={styles.body}>
          {CHANGELOG.map(release => (
            <div key={release.version} style={styles.release}>
              <div style={styles.releaseHeader}>
                <span style={styles.versionBadge}>v{release.version}</span>
                <span style={styles.releaseDate}>{release.date}</span>
              </div>
              <ul style={styles.itemList}>
                {release.items.map((item, i) => (
                  <li key={i} style={styles.item}>
                    <span style={styles.bullet}>•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center' },
  modal: { background:'var(--bg)', borderRadius:16, width:440, maxWidth:'92vw', maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' },
  header: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 20px 14px', borderBottom:'1px solid var(--border)' },
  title: { fontSize:16, fontWeight:700, color:'var(--text)' },
  closeBtn: { background:'none', border:'none', fontSize:16, cursor:'pointer', color:'var(--text-muted)', width:28, height:28, borderRadius:6 },
  body: { flex:1, overflowY:'auto', padding:'16px 20px' },
  release: { marginBottom:24 },
  releaseHeader: { display:'flex', alignItems:'center', gap:10, marginBottom:10 },
  versionBadge: { background:'var(--accent)', color:'white', fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:20 },
  releaseDate: { fontSize:12, color:'var(--text-muted)' },
  itemList: { listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:5 },
  item: { display:'flex', gap:8, fontSize:13, color:'var(--text)', lineHeight:1.5 },
  bullet: { color:'var(--accent)', flexShrink:0, fontWeight:700 },
}
