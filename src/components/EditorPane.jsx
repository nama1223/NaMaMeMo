import { useState, useRef, useEffect, useCallback } from 'react'
import RichEditor from './RichEditor'
import { TRASH_NODE_MARKER } from '../hooks/useNodes'
import { useDialog } from './DialogProvider'

export default function EditorPane({ node, onUpdateContent, onUpdateTitle, userId, settings, onEmptyTrash, onTogglePublic, onCopyPublicUrl, onOpenReminder, onNavigateAttachment, allNodes, onImportFile, searchQuery = '' }) {
  const [editingTitle, setEditingTitle] = useState(false)
  const { confirm } = useDialog()
  const [titleValue, setTitleValue] = useState('')
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false)
  const [textDropDialog, setTextDropDialog] = useState(null)
  const titleInputRef = useRef(null)
  const richEditorRef = useRef(null)

  const isTrashNode = node?.content?.includes(TRASH_NODE_MARKER) ?? false

  useEffect(() => {
    if (node) setTitleValue(node.title)
    setEditingTitle(false)
  }, [node?.id])

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  const handleTitleSubmit = () => {
    const trimmed = titleValue.trim()
    if (trimmed && trimmed !== node.title) onUpdateTitle(node.id, trimmed)
    else setTitleValue(node.title)
    setEditingTitle(false)
  }

  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter') handleTitleSubmit()
    if (e.key === 'Escape') { setTitleValue(node.title); setEditingTitle(false) }
  }

  const insertTextInline = useCallback((text) => {
    richEditorRef.current?.insertText(text)
    setTextDropDialog(null)
  }, [])

  const insertFileAttachment = useCallback((file, text) => {
    richEditorRef.current?.insertFileAttachment(file.name, text)
    setTextDropDialog(null)
  }, [])

  if (!node) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyInner}>
          <span style={styles.emptyIcon}>📝</span>
          <p style={styles.emptyText}>ツリーからノードを選択してください</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.pane}>
      {/* タイトル行 */}
      <div style={styles.header}>
        {editingTitle && !isTrashNode ? (
          <input
            ref={titleInputRef}
            style={styles.titleInput}
            value={titleValue}
            onChange={e => setTitleValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
          />
        ) : (
          <h2
            style={{ ...styles.title, opacity: isTrashNode ? 0.7 : 1 }}
            onClick={() => !isTrashNode && setEditingTitle(true)}
            title={isTrashNode ? 'ごみ箱ノード' : 'クリックして編集'}
          >
            {node.title}
            {!isTrashNode && <span style={styles.editHint}>✏️</span>}
          </h2>
        )}
        {!isTrashNode && (
          <button
            style={styles.collapseBtn}
            onClick={() => setToolbarCollapsed(v => !v)}
            title={toolbarCollapsed ? 'ツールバーを表示' : 'ツールバーを隠す'}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
              style={{ transition: 'transform 0.2s', transform: toolbarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <polyline points="4,10 8,6 12,10" />
            </svg>
          </button>
        )}
      </div>

      {/* ごみ箱ノードを選択中の場合は「空にする」ボタンを表示 */}
      {isTrashNode ? (
        <div style={styles.trashPane}>
          <div style={styles.trashIcon}>🗑</div>
          <p style={styles.trashDesc}>ごみ箱には削除したノードが入っています。</p>
          <p style={styles.trashDesc2}>ツリーの削除ボタン（左フリック）で個別に復元できます。</p>
          <button
            style={styles.emptyTrashBtn}
            onClick={async () => {
              if (await confirm('ごみ箱を空にしますか？\nごみ箱内のノードが全て完全に削除されます。この操作は取り消せません。')) {
                onEmptyTrash?.()
              }
            }}
          >
            🗑 ごみ箱を空にする
          </button>
        </div>
      ) : (
        <div style={styles.editorWrap}>
          <RichEditor
            ref={richEditorRef}
            key={node.id}
            node={node}
            onUpdateContent={onUpdateContent}
            userId={userId}
            toolbarCollapsed={toolbarCollapsed}
            onTextFileDrop={(file, text) => setTextDropDialog({ file, text })}
            settings={settings}
            onTogglePublic={onTogglePublic}
            onCopyPublicUrl={onCopyPublicUrl}
            onOpenReminder={onOpenReminder}
            onNavigateAttachment={onNavigateAttachment}
            allNodes={allNodes}
            onImportFile={onImportFile}
            searchQuery={searchQuery}
          />
        </div>
      )}

      {textDropDialog && (
        <div style={styles.dialogOverlay} onClick={() => setTextDropDialog(null)}>
          <div style={styles.dialog} onClick={e => e.stopPropagation()}>
            <div style={styles.dialogHeader}>
              <span style={styles.dialogTitle}>📄 {textDropDialog.file.name}</span>
              <button style={styles.dialogClose} onClick={() => setTextDropDialog(null)}>✕</button>
            </div>
            <p style={styles.dialogDesc}>テキストファイルをどのように挿入しますか？</p>
            <div style={styles.dialogBtns}>
              <button style={styles.dialogBtn} onClick={() => insertFileAttachment(textDropDialog.file, textDropDialog.text)}>
                📄 サムネイルとして添付
                <span style={styles.dialogBtnSub}>クリックで中身を確認できる形式</span>
              </button>
              <button style={styles.dialogBtn} onClick={() => insertTextInline(textDropDialog.text)}>
                📋 本文に展開
                <span style={styles.dialogBtnSub}>テキストをそのまま貼り付け</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  pane: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' },
  header: { padding: '8px 12px 8px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 8 },
  title: { flex: 1, margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)', cursor: 'text', display: 'flex', alignItems: 'center', gap: 8, borderRadius: 6, padding: '2px 6px', marginLeft: -6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  editHint: { fontSize: 12, opacity: 0.4, flexShrink: 0 },
  titleInput: { flex: 1, fontSize: 18, fontWeight: 700, border: 'none', borderBottom: '2px solid var(--accent)', outline: 'none', background: 'transparent', color: 'var(--text)', padding: '2px 4px', width: '100%' },
  collapseBtn: { flexShrink: 0, width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' },
  editorWrap: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  empty: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', background: 'var(--bg)' },
  emptyInner: { textAlign: 'center', color: 'var(--text-muted)' },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 14, marginTop: 12 },
  // ごみ箱ビュー
  trashPane: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  trashIcon: { fontSize: 56, opacity: 0.4 },
  trashDesc: { fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', margin: 0 },
  trashDesc2: { fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 0 },
  emptyTrashBtn: { marginTop: 16, padding: '10px 24px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, fontSize: 14, cursor: 'pointer', color: '#dc2626', fontWeight: 600 },
  dialogOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  dialog: { background: 'var(--bg)', borderRadius: 14, width: 320, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' },
  dialogHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--border)' },
  dialogTitle: { fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dialogClose: { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: 'var(--text-muted)', width: 24, height: 24, borderRadius: 4, flexShrink: 0 },
  dialogDesc: { fontSize: 13, color: 'var(--text-muted)', padding: '10px 16px 8px' },
  dialogBtns: { display: 'flex', flexDirection: 'column' },
  dialogBtn: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '12px 16px', background: 'none', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer', fontSize: 14, color: 'var(--text)', textAlign: 'left', transition: 'background 0.1s' },
  dialogBtnSub: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 },
}
