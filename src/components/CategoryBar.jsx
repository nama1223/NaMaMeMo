import { useState, useRef, useCallback } from 'react'
import { useDialog } from './DialogProvider'

export default function CategoryBar({
  categories,
  activeCategoryId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onReorder,
}) {
  const { confirm } = useDialog()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  // ── ポインター統一D&D ──
  const draggingIdx = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)
  const itemRefs = useRef([])

  const handleDragHandlePointerDown = useCallback((e, idx) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingIdx.current = idx
    setDragOverIdx(idx)
  }, [])

  const handleDragHandlePointerMove = useCallback((e) => {
    if (draggingIdx.current === null) return
    // タッチ位置にある要素のインデックスを探す
    const x = e.clientX, y = e.clientY
    let found = null
    itemRefs.current.forEach((el, i) => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (y >= rect.top && y <= rect.bottom) found = i
    })
    if (found !== null && found !== dragOverIdx) setDragOverIdx(found)
  }, [dragOverIdx])

  const handleDragHandlePointerUp = useCallback((e) => {
    const from = draggingIdx.current
    const to = dragOverIdx
    draggingIdx.current = null
    setDragOverIdx(null)
    if (from === null || to === null || from === to) return
    const newOrder = [...categories]
    const [moved] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, moved)
    onReorder(newOrder)
  }, [dragOverIdx, categories, onReorder])

  const handleRenameStart = (cat) => {
    setRenamingId(cat.id)
    setRenameValue(cat.name)
  }
  const handleRenameSubmit = () => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }

  const handleAdd = async () => {
    const cat = await onAdd()
    if (cat) {
      setMenuOpen(false)
      onSelect(cat.id)
      setMenuOpen(true)
      setTimeout(() => { setRenamingId(cat.id); setRenameValue('無題のカテゴリ') }, 60)
    }
  }

  const handleDelete = async (cat) => {
    if (await confirm(`「${cat.name}」を削除しますか？\n中のノードも全て削除されます。`)) {
      onDelete(cat.id)
    }
  }

  return (
    <div style={styles.bar}>
      <button style={styles.categoryBtn} onClick={() => setMenuOpen(v => !v)} title="カテゴリ管理">
        <FolderIcon />
        <span style={{ fontSize: 11 }}>カテゴリ</span>
        <span style={{ fontSize: 8, opacity: 0.8 }}>{menuOpen ? '▲' : '▼'}</span>
      </button>

      <select
        style={styles.select}
        value={activeCategoryId || ''}
        onChange={e => onSelect(e.target.value)}
      >
        {categories.map(cat => (
          <option key={cat.id} value={cat.id}>{cat.name}</option>
        ))}
      </select>

      {menuOpen && (
        <>
          <div style={styles.menuOverlay} onClick={() => setMenuOpen(false)} />
          <div style={styles.menu}>
            <div style={styles.menuHeader}>
              <span style={styles.menuTitle}>カテゴリ管理</span>
              <button style={styles.menuAddBtn} onClick={handleAdd}>＋ 追加</button>
            </div>

            <div style={styles.menuList}>
              {categories.map((cat, idx) => (
                <div
                  key={cat.id}
                  ref={el => itemRefs.current[idx] = el}
                  style={{
                    ...styles.menuItem,
                    background: dragOverIdx === idx
                      ? 'var(--accent-bg)'
                      : cat.id === activeCategoryId ? 'var(--accent-bg)' : 'transparent',
                    borderTop: dragOverIdx === idx && draggingIdx.current !== idx
                      ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  {/* ドラッグハンドル：PointerEvents統一 */}
                  <span
                    style={styles.dragHandle}
                    title="ドラッグして並べ替え"
                    onPointerDown={e => handleDragHandlePointerDown(e, idx)}
                    onPointerMove={handleDragHandlePointerMove}
                    onPointerUp={handleDragHandlePointerUp}
                    onPointerCancel={() => { draggingIdx.current = null; setDragOverIdx(null) }}
                  >
                    ⠿
                  </span>

                  {renamingId === cat.id ? (
                    <input
                      autoFocus
                      style={styles.renameInput}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={handleRenameSubmit}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameSubmit()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <span
                      style={styles.menuItemName}
                      onClick={() => { onSelect(cat.id); setMenuOpen(false) }}
                      onDoubleClick={() => handleRenameStart(cat)}
                    >
                      {cat.name}
                    </span>
                  )}

                  <div style={styles.menuItemActions}>
                    <button style={styles.menuIconBtn} onClick={() => handleRenameStart(cat)} title="名前変更">✏️</button>
                    <button
                      style={{ ...styles.menuIconBtn, color: '#e53e3e' }}
                      onClick={() => handleDelete(cat)}
                      title="削除"
                      disabled={categories.length <= 1}
                    >🗑</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={styles.menuFooter}>
              <span style={styles.menuHint}>ハンドル（⠿）をドラッグで並べ替え</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 16" fill="currentColor">
      <path d="M1 3a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3z"/>
    </svg>
  )
}

const styles = {
  bar: {
    display: 'flex', alignItems: 'center', gap: 0,
    padding: '6px 6px', borderBottom: '1px solid var(--border)',
    background: 'var(--surface)', flexShrink: 0, position: 'relative',
  },
  categoryBtn: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', background: 'var(--accent)', color: 'white',
    border: 'none', borderRadius: '6px 0 0 6px', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, height: 28, flexShrink: 0, whiteSpace: 'nowrap',
  },
  select: {
    flex: 1, height: 28, border: '1px solid var(--border)', borderLeft: 'none',
    borderRadius: '0 6px 6px 0', background: 'var(--bg)', color: 'var(--text)',
    fontSize: 13, padding: '0 6px', cursor: 'pointer', outline: 'none', minWidth: 0,
  },
  menuOverlay: { position: 'fixed', inset: 0, zIndex: 99 },
  menu: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: '0 0 10px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
  },
  menuHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px 6px', borderBottom: '1px solid var(--border)',
  },
  menuTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  menuAddBtn: {
    padding: '3px 10px', background: 'var(--accent)', color: 'white',
    border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontWeight: 600,
  },
  menuList: { maxHeight: 240, overflowY: 'auto' },
  menuItem: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 10px', transition: 'background 0.1s',
  },
  dragHandle: {
    fontSize: 16, color: 'var(--text-muted)',
    cursor: 'grab', flexShrink: 0,
    userSelect: 'none', touchAction: 'none',
    padding: '4px 2px',   // タップ領域を広げる
    lineHeight: 1,
  },
  menuItemName: {
    flex: 1, fontSize: 13, color: 'var(--text)', cursor: 'pointer',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  menuItemActions: { display: 'flex', gap: 2, flexShrink: 0 },
  menuIconBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 13, padding: '2px 3px', borderRadius: 4, lineHeight: 1,
  },
  renameInput: {
    flex: 1, fontSize: 13, border: 'none', borderBottom: '2px solid var(--accent)',
    outline: 'none', background: 'transparent', color: 'var(--text)', padding: '1px 2px',
  },
  menuFooter: { padding: '6px 12px', borderTop: '1px solid var(--border)' },
  menuHint: { fontSize: 10, color: 'var(--text-muted)' },
}
