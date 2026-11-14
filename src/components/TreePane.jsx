/**
 * TreePane v2
 *
 * D&D修正：dragState と dropTarget を ref でも持ち、
 * endDrag が常に最新値を参照できるようにする
 * （useCallback の依存から外して stale closure を防止）
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import TreeNode from './TreeNode'
import CategoryBar from './CategoryBar'
import FlickButton from './FlickButton'
import SearchAndStyleBar from './SearchAndStyleBar'
import { TRASH_NODE_MARKER } from '../hooks/useNodes'
import { useDialog } from './DialogProvider'

export default function TreePane({
  categories, activeCategoryId,
  onSelectCategory, onAddCategory, onRenameCategory, onDeleteCategory, onReorderCategories,
  nodes, loading, selectedId,
  onSelect, onAddBefore, onAddAfter, onAddChild,
  onDelete, onMoveToTrash, onRestoreFromTrash,
  onUpdateTitle, onToggle,
  onMoveNode, onMoveNodeTo, onToast,
  onUpdateNodeStyle,
  onMoveToCategoryBranch,
  settings,
  searchQuery = '',
  onSearchQueryChange,
}) {
  const { confirm } = useDialog()
  const hideTrash = settings?.hideTrash ?? false
  const nodeLineHeight = settings?.nodeLineHeight ?? 1.4

  const trashNode = nodes.find(n => n.content?.includes(TRASH_NODE_MARKER))

  const visibleNodes = hideTrash && trashNode
    ? nodes.filter(n => {
        if (n.id === trashNode.id) return false
        let cur = n
        while (cur?.parent_id) {
          if (cur.parent_id === trashNode.id) return false
          cur = nodes.find(p => p.id === cur.parent_id)
        }
        return true
      })
    : nodes

  const rootNodes = visibleNodes
    .filter(n => n.parent_id === null)
    .sort((a, b) => a.position - b.position)

  const selectedNode = nodes.find(n => n.id === selectedId) || null

  const isInTrash = selectedNode ? (() => {
    let n = selectedNode
    while (n) {
      if (n.content?.includes(TRASH_NODE_MARKER)) return true
      n = nodes.find(p => p.id === n.parent_id)
    }
    return false
  })() : false

  const isSelectedTrashNode = selectedNode?.content?.includes(TRASH_NODE_MARKER) ?? false

  // ── 検索状態はApp.jsxから props で受け取る ──

  // 検索キーワードで絞り込んだノードのフラットなリスト（★本文も検索対象に追加）
  const searchedNodes = searchQuery
    ? visibleNodes.filter(n => {
        const q = searchQuery.toLowerCase();
        // タイトルの検索
        const titleMatch = (n.title || '').toLowerCase().includes(q);
        
        // 本文の検索（HTMLタグを除去してプレーンテキスト化してから判定）
        const plainContent = (n.content || '').replace(/<[^>]*>?/gm, '');
        const contentMatch = plainContent.toLowerCase().includes(q);
        
        return titleMatch || contentMatch;
      })
    : []

  // ── D&D 状態 ──
  // state はレンダリング用、ref は endDrag 内での最新値参照用
  const [dragState, setDragState] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const dragStateRef = useRef(null)
  const dropTargetRef = useRef(null)
  const treeRef = useRef(null)
  const onMoveNodeToRef = useRef(onMoveNodeTo)
  const onToastRef = useRef(onToast)
  const nodesRef = useRef(nodes)
  useEffect(() => { onMoveNodeToRef.current = onMoveNodeTo }, [onMoveNodeTo])
  useEffect(() => { onToastRef.current = onToast }, [onToast])
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  const startDrag = useCallback((nodeId, title, x, y) => {
    if (navigator.vibrate) navigator.vibrate(40)
    const state = { nodeId, title, ghostX: x, ghostY: y }
    dragStateRef.current = state
    dropTargetRef.current = null
    setDragState(state)
    setDropTarget(null)
    onToastRef.current?.('ドラッグして移動先で離してください')
  }, [])

  const updateDrag = useCallback((x, y) => {
    // ghost 位置更新
    if (dragStateRef.current) {
      const next = { ...dragStateRef.current, ghostX: x, ghostY: y }
      dragStateRef.current = next
      setDragState(next)
    }

    // カテゴリバー上にいるか判定
    const catBar = document.querySelector('[data-category-bar]')
    if (catBar) {
      const rect = catBar.getBoundingClientRect()
      const over = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      catBarHighlightRef.current = over
      setCatBarHighlight(over)
      if (over) { setDropTarget(null); return }
    } else {
      catBarHighlightRef.current = false
      setCatBarHighlight(false)
    }
    
    // ★ 修正: document.elementFromPoint を使って、画面上の(x, y)座標にある要素を直接狙い撃ちする
    // これによりスマホのスクロールやDOM構造のネストに左右されずにドロップ先を正確に取得できます。
    const elUnderPointer = document.elementFromPoint(x, y)
    if (!elUnderPointer) return

    // その要素から一番近いツリーのノード行（[data-node-id]を持つ要素）を探す
    const row = elUnderPointer.closest('[data-node-id]')
    let found = null

    if (row) {
      const nodeId = row.dataset.nodeId
      const rect = row.getBoundingClientRect()
      
      // 行の中での相対的なY座標を計算し、前/後/子 のどこにドロップするかを判定
      const relY = y - rect.top
      const h = rect.height
      const pos = relY < h * 0.28 ? 'before' : relY > h * 0.72 ? 'after' : 'child'
      found = { nodeId, pos }
    }

    dropTargetRef.current = found
    setDropTarget(found)
  }, [])

  const endDrag = useCallback(async () => {
    const draggingNodeId = dragStateRef.current?.nodeId
    const target = dropTargetRef.current
    const onCatBar = catBarHighlightRef.current

    dragStateRef.current = null
    dropTargetRef.current = null
    catBarHighlightRef.current = false
    setDragState(null)
    setDropTarget(null)
    setCatBarHighlight(false)
    onToastRef.current?.(null)

    if (!draggingNodeId) return

    if (onCatBar) {
      const draggedNode = nodesRef.current?.find(n => n.id === draggingNodeId)
        || { id: draggingNodeId, title: draggingNodeId }
      const collectDescs = (id) => {
        const result = []
        ;(nodesRef.current || [])
          .filter(n => n.parent_id === id)
          .sort((a, b) => a.position - b.position)
          .forEach(c => { result.push(c); result.push(...collectDescs(c.id)) })
        return result
      }
      const descendants = collectDescs(draggingNodeId)
      setCategoryMoveModal({ nodeId: draggingNodeId, nodeTitle: draggedNode.title, descendants })
      return
    }

    if (!target || target.nodeId === draggingNodeId) return

    onToastRef.current?.('移動中…')
    await onMoveNodeToRef.current(draggingNodeId, target.nodeId, target.pos)
    onToastRef.current?.(null)
  }, []) // 依存なし・全てref経由

  const cancelDrag = useCallback(() => {
    dragStateRef.current = null
    dropTargetRef.current = null
    setDragState(null)
    setDropTarget(null)
    onToastRef.current?.(null)
  }, [])

  // ── 移動可否 ──
  const canMove = (dir) => {
    if (!selectedNode) return false
    if (isInTrash) return false
    if (isSelectedTrashNode) {
      if (dir === 'indent' || dir === 'outdent') return false
    }
    const parentId = selectedNode.parent_id ?? null
    const siblings = visibleNodes.filter(n => (n.parent_id ?? null) === parentId).sort((a, b) => a.position - b.position)
    const idx = siblings.findIndex(n => n.id === selectedId)
    if (dir === 'up')      return idx > 0
    if (dir === 'down')    return idx < siblings.length - 1
    if (dir === 'outdent') return parentId !== null
    if (dir === 'indent')  return idx > 0
    return false
  }

  const withToast = useCallback((label, fn) => async (...args) => {
    onToast?.(`${label}中…`)
    await fn(...args)
    onToast?.(null)
  }, [onToast])

  const has = !!selectedNode && !isSelectedTrashNode

  const deleteActions = isInTrash && !isSelectedTrashNode
    ? {
        left: {
          label: '復元',
          disabled: !selectedNode,
          onAction: withToast('復元', () => onRestoreFromTrash(selectedNode.id)),
        },
        down: {
          label: '完全削除',
          disabled: !selectedNode,
          onAction: async () => {
            if (selectedNode && await confirm(`「${selectedNode.title}」を完全に削除しますか？\nこの操作は取り消せません。`)) {
              onDelete(selectedNode.id)
            }
          },
        },
      }
    : {
        down: {
          label: '完全削除',
          disabled: !has,
          onAction: async () => {
            if (has && await confirm(`「${selectedNode.title}」を完全に削除しますか？\nこの操作は取り消せません。`)) {
              onDelete(selectedNode.id)
            }
          },
        },
      }

  const parallelActions = {
    up: { label: '前に挿入', disabled: !has, onAction: withToast('前にノードを追加', () => onAddBefore(selectedNode)) },
    down: { label: '後に追加', disabled: false, onAction: withToast('後にノードを追加', () => has ? onAddAfter(selectedNode) : onAddAfter(null)) },
    left: { label: 'キャンセル', disabled: false, onAction: () => {} },
    right: { label: 'キャンセル', disabled: false, onAction: () => {} },
  }

  const moveActions = {
    up:    { label: '上へ',       disabled: !canMove('up'),      onAction: withToast('上に移動',   () => onMoveNode(selectedId, 'up'))      },
    down:  { label: '下へ',       disabled: !canMove('down'),    onAction: withToast('下に移動',   () => onMoveNode(selectedId, 'down'))    },
    left:  { label: '親に上げる', disabled: !canMove('outdent'), onAction: withToast('親に移動',   () => onMoveNode(selectedId, 'outdent')) },
    right: { label: '子に下げる', disabled: !canMove('indent'),  onAction: withToast('子に移動',   () => onMoveNode(selectedId, 'indent'))  },
  }

  const [categoryMoveModal, setCategoryMoveModal] = useState(null)
  const categoryBarRef = useRef(null)
  const [catBarHighlight, setCatBarHighlight] = useState(false)
  const catBarHighlightRef = useRef(false)

  const draggingId = dragState?.nodeId || null

  const handleDeleteBtnTap = useCallback(async () => {
    if (!selectedNode) return
    if (isInTrash && !isSelectedTrashNode) {
      if (await confirm(`「${selectedNode.title}」を完全に削除しますか？\nこの操作は取り消せません。`)) {
        onDelete(selectedNode.id)
      }
    } else if (isSelectedTrashNode) {
      // ごみ箱ノード自体：何もしない（エディタの「空にする」を使う）
    } else {
      onMoveToTrash(selectedNode.id)
    }
  }, [selectedNode, isInTrash, isSelectedTrashNode, onDelete, onMoveToTrash, confirm])

  return (
    <div style={styles.pane}>
      {/* 検索バー ＆ スタイルパレット */}
      <SearchAndStyleBar 
        searchQuery={searchQuery}
        onSearchChange={onSearchQueryChange}
        selectedNode={selectedNode}
        onUpdateNodeStyle={onUpdateNodeStyle} // ★ 親から受け取った関数をそのまま渡す
      />

      <div data-category-bar style={catBarHighlight ? { outline: '2.5px solid var(--accent)', borderRadius: 4, transition: 'outline 0.1s' } : {}}>
        <CategoryBar
          categories={categories} activeCategoryId={activeCategoryId}
          onSelect={onSelectCategory} onAdd={onAddCategory}
          onRename={onRenameCategory} onDelete={onDeleteCategory}
          onReorder={onReorderCategories}
        />
      </div>

      <div style={styles.actionBar}>
        <FlickButton label="≡+" title="並列ノード" actions={parallelActions} />
        <button
          title="子ノードとして追加" disabled={!has}
          onClick={withToast('子ノードを追加', () => onAddChild(selectedNode))}
          style={actionBtnStyle(!has, false)}
        >
          <InsertChildIcon />
          <span style={styles.actionLabel}>子を追加</span>
        </button>
        <FlickButton label="⇅" title="移動" disabled={!selectedNode} actions={selectedNode ? moveActions : {}} />
        <FlickButton
          label={
            isInTrash && !isSelectedTrashNode ? '🗑'
            : isSelectedTrashNode ? '🗑'
            : <span style={{display:'flex',flexDirection:'column',alignItems:'center',gap:1}}>
                <span>🗑</span>
                <span style={{fontSize:8,color:'inherit',lineHeight:1}}>↓完全削除</span>
              </span>
          }
          title={
            isInTrash && !isSelectedTrashNode
              ? '削除（←復元 / ↓完全削除）'
              : isSelectedTrashNode
              ? '（エディタで操作）'
              : 'ごみ箱'
          }
          disabled={!selectedNode || isSelectedTrashNode}
          actions={deleteActions}
          onTap={handleDeleteBtnTap}
        />
      </div>

      <div ref={treeRef} style={styles.tree}>
        {loading ? (
          <div style={styles.empty}>読み込み中…</div>
        ) : searchQuery ? (
          // ★ 検索中：フラットなリストとして表示する
          searchedNodes.length === 0 ? (
            <div style={styles.empty}>一致するノードが見つかりません</div>
          ) : (
            searchedNodes.map(node => (
              <TreeNode
                key={node.id} 
                node={node} 
                nodes={[]}
                selectedId={selectedId}
                onSelect={onSelect} 
                onToggle={() => {}}
                draggingId={draggingId}
                dropTarget={null}
                onDragStart={() => {}}
                onDragMove={() => {}}
                onDragEnd={() => {}}
                onDragCancel={() => {}}
                depth={0}
                trashNodeId={trashNode?.id}
                nodeLineHeight={nodeLineHeight}
                searchQuery={searchQuery}
              />
            ))
          )
        ) : rootNodes.length === 0 ? (
          <div style={styles.empty}>
            <p>ノードがありません</p>
            <button style={styles.emptyBtn} onClick={withToast('ノードを追加', () => onAddAfter(null))}>
              ＋ 最初のノードを作成
            </button>
          </div>
        ) : (
          rootNodes.map(node => (
            <TreeNode
              key={node.id} node={node} nodes={visibleNodes}
              selectedId={selectedId}
              onSelect={onSelect} onToggle={onToggle}
              draggingId={draggingId}
              dropTarget={dropTarget}
              onDragStart={startDrag}
              onDragMove={updateDrag}
              onDragEnd={endDrag}
              onDragCancel={cancelDrag}
              depth={0}
              trashNodeId={trashNode?.id}
              nodeLineHeight={nodeLineHeight}
            />
          ))
        )}
      </div>

      {dragState && (
        <div style={{
          position: 'fixed',
          left: dragState.ghostX + 12,
          top: dragState.ghostY - 16,
          pointerEvents: 'none',
          zIndex: 1000,
          background: 'var(--accent)',
          color: 'white',
          padding: '6px 14px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          maxWidth: 200,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: 0.92,
        }}>
          ✥ {dragState.title}
        </div>
      )}
      {/* カテゴリ移動モーダル */}
      {categoryMoveModal && (
        <CategoryMoveModal
          modal={categoryMoveModal}
          categories={categories}
          activeCategoryId={activeCategoryId}
          onConfirm={async (targetCategoryId) => {
            setCategoryMoveModal(null)
            onToast?.('カテゴリ移動中…')
            const ok = await onMoveToCategoryBranch?.(categoryMoveModal.nodeId, targetCategoryId)
            onToast?.(ok ? '移動しました' : '移動に失敗しました')
            setTimeout(() => onToast?.(null), 2000)
          }}
          onClose={() => setCategoryMoveModal(null)}
        />
      )}
    </div>
  )
}

// ── カテゴリ移動確認モーダル ──
function CategoryMoveModal({ modal, categories, activeCategoryId, onConfirm, onClose }) {
  const [selectedCatId, setSelectedCatId] = useState(null)
  const otherCats = categories.filter(c => c.id !== activeCategoryId)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--bg)', borderRadius:14, width:'min(380px,92vw)', maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,0.25)', overflow:'hidden' }} onClick={e=>e.stopPropagation()}>
        {/* ヘッダー */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px 10px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>📂 カテゴリへ移動</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>「{modal.nodeTitle}」</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:16, cursor:'pointer', color:'var(--text-muted)' }}>✕</button>
        </div>

        {/* 移動対象プレビュー */}
        <div style={{ padding:'10px 16px 6px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>移動対象（{1 + modal.descendants.length}件）</div>
          <div style={{ maxHeight:100, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
            <div style={{ fontSize:12, color:'var(--text)', fontWeight:600, padding:'2px 0' }}>📄 {modal.nodeTitle}</div>
            {modal.descendants.map((d, i) => (
              <div key={d.id} style={{ fontSize:11, color:'var(--text-muted)', paddingLeft: Math.min(d._depth || 8, 32) }}>└ {d.title}</div>
            ))}
          </div>
        </div>

        {/* 移動先選択 */}
        <div style={{ padding:'10px 16px 6px', flexShrink:0 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>移動先カテゴリ</div>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'0 8px 8px' }}>
          {otherCats.length === 0 ? (
            <div style={{ fontSize:12, color:'var(--text-muted)', textAlign:'center', padding:16 }}>他のカテゴリがありません</div>
          ) : otherCats.map(cat => (
            <button key={cat.id}
              onClick={() => setSelectedCatId(cat.id)}
              style={{
                display:'block', width:'100%', textAlign:'left',
                padding:'10px 14px', marginBottom:4,
                background: selectedCatId === cat.id ? 'var(--accent-bg)' : 'var(--surface)',
                border: selectedCatId === cat.id ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                borderRadius:8, fontSize:13, cursor:'pointer',
                color: selectedCatId === cat.id ? 'var(--accent)' : 'var(--text)',
                fontWeight: selectedCatId === cat.id ? 700 : 400,
              }}
            >
              📁 {cat.name}
            </button>
          ))}
        </div>

        {/* フッター */}
        <div style={{ display:'flex', gap:8, padding:'10px 16px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
          <button onClick={onClose} style={{ flex:1, padding:'8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, fontSize:13, cursor:'pointer', color:'var(--text)' }}>
            キャンセル
          </button>
          <button
            onClick={() => selectedCatId && onConfirm(selectedCatId)}
            disabled={!selectedCatId}
            style={{ flex:1, padding:'8px', background: selectedCatId ? 'var(--accent)' : 'var(--border)', border:'none', borderRadius:8, fontSize:13, cursor: selectedCatId ? 'pointer' : 'default', color:'white', fontWeight:600 }}
          >
            移動する
          </button>
        </div>
      </div>
    </div>
  )
}

function actionBtnStyle(disabled, danger) {
  return {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 2, padding: '5px 2px',
    background: 'none', border: 'none', borderRight: '1px solid var(--border)',
    cursor: disabled ? 'default' : 'pointer',
    color: danger ? (disabled ? 'var(--text-muted)' : '#e53e3e') : (disabled ? 'var(--text-muted)' : 'var(--text)'),
    opacity: disabled ? 0.35 : 1, transition: 'background 0.1s', touchAction: 'manipulation',
  }
}

function InsertChildIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <rect x="1" y="2" width="10" height="3" rx="1.5"/>
      <rect x="5" y="13" width="12" height="3" rx="1.5" opacity="0.35"/>
      <path d="M3 5 Q3 14 5 14" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.5"/>
      <rect x="10" y="8" width="2" height="6" rx="1" fill="var(--accent)"/>
      <polygon points="11,17 8.5,13.5 13.5,13.5" fill="var(--accent)"/>
    </svg>
  )
}

const styles = {
  pane: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)', overflow: 'hidden', position: 'relative' },
  actionBar: { display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)', flexShrink: 0, overflow: 'visible', position: 'relative', zIndex: 10 },
  actionLabel: { fontSize: 9, whiteSpace: 'nowrap' },  tree: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 4px' },
  empty: { padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 },
  emptyBtn: { marginTop: 8, padding: '6px 14px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
}
