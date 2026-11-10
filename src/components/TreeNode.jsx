/**
 * TreeNode v8
 *
 * スマホD&D確定修正版：
 * - onTouchEnd から直接 onDragEndRef.current() を呼ぶ
 * - touchmove は useEffect + { passive: false } でネイティブ登録
 * - 長押し確定後のみ e.preventDefault() でスクロール停止
 * - PC は pointer events
 */
import { useRef, useState, useCallback, useEffect } from 'react'

const LONG_PRESS_MS = 220
const CANCEL_PX = 8

export default function TreeNode({
  node, nodes = [], selectedId,
  onSelect, onToggle,
  draggingId, dropTarget,
  onDragStart, onDragMove, onDragEnd, onDragCancel,
  depth = 0,
  trashNodeId,
  nodeLineHeight = 1.4,
  searchQuery = '',
}) {
  // undefined エラーを防ぐため、nodes のフォールバックと node のオプショナルチェーンを追加
  const children = (nodes || []).filter(n => n.parent_id === node?.id).sort((a, b) => a.position - b.position)
  const hasChildren = children.length > 0
  const isSelected = selectedId === node?.id
  const isDragging = draggingId === node?.id
  const isDropTarget = dropTarget?.nodeId === node?.id
  const dropPos = isDropTarget ? dropTarget.pos : null

  const rowRef = useRef(null)
  const longPressTimer = useRef(null)
  const touchStartRef = useRef(null)
  const isLongPressedRef = useRef(false)

  // ★ 最新のコールバックをrefで保持（stale closureを防ぐ）
  const draggingIdRef = useRef(draggingId)
  const onDragMoveRef = useRef(onDragMove)
  const onDragEndRef = useRef(onDragEnd)
  const onDragCancelRef = useRef(onDragCancel)
  const onSelectRef = useRef(onSelect)
  const nodeIdRef = useRef(node?.id)

  // レンダリングのたびに最新値でrefを更新
  draggingIdRef.current = draggingId
  onDragMoveRef.current = onDragMove
  onDragEndRef.current = onDragEnd
  onDragCancelRef.current = onDragCancel
  onSelectRef.current = onSelect
  nodeIdRef.current = node?.id

  const clearTimer = () => {
    clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }

  // ── タッチ開始（React イベント）──
  const onTouchStart = useCallback((e) => {
    if (draggingIdRef.current) return
    if (e.touches.length > 1) return
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY, identifier: t.identifier }
    isLongPressedRef.current = false

    longPressTimer.current = setTimeout(() => {
      if (!touchStartRef.current) return
      isLongPressedRef.current = true
      if (navigator.vibrate) navigator.vibrate(30)
      onDragStart(nodeIdRef.current, node?.title, touchStartRef.current.x, touchStartRef.current.y)
    }, LONG_PRESS_MS)
  }, [node?.title, onDragStart]) // onDragStartのみ依存（startDragはuseCallbackで安定）

  // ── touchmove: useEffect でネイティブ登録（passive: false）──
  useEffect(() => {
    const el = rowRef.current; if (!el) return
    const handleMove = (e) => {
      if (!touchStartRef.current) return
      const touch = Array.from(e.touches).find(t => t.identifier === touchStartRef.current.identifier)
      if (!touch) return

      // 移動距離を記録（縦スクロールと横移動の両方を考慮）
      const dx = Math.abs(touch.clientX - touchStartRef.current.x)
      const dy = Math.abs(touch.clientY - touchStartRef.current.y)
      // 縦移動を重視（ツリーは縦スクロールのため）
      touchMoveDistRef.current = Math.max(touchMoveDistRef.current, dy, dx * 0.5)

      if (isLongPressedRef.current || draggingIdRef.current) {
        // 確定後：スクロール停止 + ドラッグ更新
        e.preventDefault()
        onDragMoveRef.current(touch.clientX, touch.clientY)
      } else {
        // 待機中：閾値超えでキャンセル（スクロール許可）
        const dx = Math.abs(touch.clientX - touchStartRef.current.x)
        const dy = Math.abs(touch.clientY - touchStartRef.current.y)
        if (dx > CANCEL_PX || dy > CANCEL_PX) {
          clearTimer()
          touchStartRef.current = null
          isLongPressedRef.current = false
        }
      }
    }
    el.addEventListener('touchmove', handleMove, { passive: false })
    return () => el.removeEventListener('touchmove', handleMove)
  }, []) // マウント時のみ。最新値はref経由

  // ── タッチ終了（React イベント）──
  // スクロール判定用（どれだけ動いたか記録）
  const touchMoveDistRef = useRef(0)

  const onTouchEnd = useCallback((e) => {
    clearTimer()
    const wasLP = isLongPressedRef.current
    const wasDragging = !!draggingIdRef.current
    const moveDist = touchMoveDistRef.current
    touchStartRef.current = null
    isLongPressedRef.current = false
    touchMoveDistRef.current = 0

    if (wasDragging || wasLP) {
      onDragEndRef.current()
    } else if (moveDist < 5) {
      // 5px未満の移動のみタップと判定
      // スクロール操作（通常10px以上）は選択しない
      onSelectRef.current(nodeIdRef.current)
    }
    // moveDist >= 5 の場合はスクロール判定→選択しない
  }, [])

  const onTouchCancel = useCallback(() => {
    clearTimer()
    touchStartRef.current = null
    isLongPressedRef.current = false
    onDragCancelRef.current()
  }, [])

// ── PC: pointer events ──
  const mouseState = useRef(null)
  const mouseIsLPRef = useRef(false)
  const mouseTimer = useRef(null)
  const isPointerDownRef = useRef(false)
  const [, setForceUpdate] = useState(0)

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0 || e.pointerType === 'touch' || draggingIdRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    mouseState.current = { startX: e.clientX, startY: e.clientY }
    mouseIsLPRef.current = false
    isPointerDownRef.current = true

    // ★ マウスの場合は長押しタイマーをセットしない（動かした瞬間にドラッグ開始するため）
    if (e.pointerType !== 'mouse') {
      mouseTimer.current = setTimeout(() => {
        if (!mouseState.current) return
        mouseIsLPRef.current = true
        setForceUpdate(n => n + 1)
        onDragStart(nodeIdRef.current, node?.title, mouseState.current.startX, mouseState.current.startY)
      }, LONG_PRESS_MS)
    }
  }, [node?.title, onDragStart])

  const onPointerMove = useCallback((e) => {
    if (e.pointerType === 'touch' || !mouseState.current) return
    const dx = Math.abs(e.clientX - mouseState.current.startX)
    const dy = Math.abs(e.clientY - mouseState.current.startY)

    if (!mouseIsLPRef.current && !draggingIdRef.current) {
      if (dx > CANCEL_PX || dy > CANCEL_PX) {
        if (e.pointerType === 'mouse') {
          // ★ マウスなら閾値（8px）を超えて動かした瞬間に即ドラッグ開始！
          clearTimeout(mouseTimer.current)
          mouseIsLPRef.current = true
          onDragStart(nodeIdRef.current, node?.title, mouseState.current.startX, mouseState.current.startY)
          onDragMoveRef.current(e.clientX, e.clientY) // 初回の移動分も反映
        } else {
          // マウス以外（ペン等）で長押し前に動いた場合はキャンセル
          clearTimeout(mouseTimer.current)
          mouseState.current = null
          mouseIsLPRef.current = false
          isPointerDownRef.current = false
        }
      }
      return
    }
    // すでにドラッグ中なら更新
    onDragMoveRef.current(e.clientX, e.clientY)
  }, [node?.title, onDragStart]) // 依存関係を追加

  const onPointerUp = useCallback((e) => {
    if (e.pointerType === 'touch') return
    clearTimeout(mouseTimer.current)
    const wasLP = mouseIsLPRef.current || !!draggingIdRef.current
    const wasPointerDownHere = isPointerDownRef.current

    mouseState.current = null
    mouseIsLPRef.current = false
    isPointerDownRef.current = false

    if (wasLP) {
      onDragEndRef.current()
    } else if (wasPointerDownHere) {
      // 動かさずにボタンを離した場合は「クリック（選択）」になる
      onSelectRef.current(nodeIdRef.current)
    }
  }, [])

  const onPointerCancel = useCallback((e) => {
    if (e.pointerType === 'touch') return
    clearTimeout(mouseTimer.current)
    mouseState.current = null
    mouseIsLPRef.current = false
    isPointerDownRef.current = false
    onDragCancelRef.current()
  }, [])


  // ★ 追加：スタイル（JSON）をCSSオブジェクトに変換する関数
  const getTitleStyle = (styleObj) => {
    if (!styleObj) return {};
    return {
      fontWeight: styleObj.bold ? '900' : 'normal',
      fontStyle: styleObj.italic ? 'italic' : 'normal',
      textDecoration: `${styleObj.underline ? 'underline ' : ''}${styleObj.strike ? 'line-through' : ''}`.trim() || 'none',
      color: styleObj.color || 'inherit',
      backgroundColor: styleObj.highlight || 'transparent',
      padding: styleObj.highlight ? '0 4px' : '0',
      borderRadius: styleObj.highlight ? '4px' : '0'
    };
  };

  // nodeLineHeight を行間→実際の高さに変換（0.8=24px, 1.4=34px, 2.4=52px）
  const nodeMinHeight = Math.round(nodeLineHeight * 24)

  // タイトルのマッチ部分をハイライト表示
  const renderHighlightedTitle = (title, query) => {
    if (!query || !title) return title
    const idx = title.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return title
    return (
      <>
        {title.slice(0, idx)}
        <mark style={{ background: '#fef08a', color: '#1a1a1a', borderRadius: 2, padding: '0 1px' }}>
          {title.slice(idx, idx + query.length)}
        </mark>
        {title.slice(idx + query.length)}
      </>
    )
  }

  const rowStyle = {
    display: 'flex', alignItems: 'center', minHeight: nodeMinHeight,
    borderRadius: 6, gap: 4, paddingRight: 8, paddingLeft: depth * 16 + 8,
    background: dropPos === 'child' ? 'rgba(91,106,240,0.15)' : isSelected ? 'var(--accent-bg)' : 'transparent',
    color: isSelected ? 'var(--accent)' : 'var(--text)',
    opacity: isDragging ? 0.3 : 1,
    cursor: draggingId ? (isDragging ? 'grabbing' : 'copy') : 'pointer',
    borderTop: dropPos === 'before' ? '2px solid var(--accent)' : '2px solid transparent',
    borderBottom: dropPos === 'after' ? '2px solid var(--accent)' : '2px solid transparent',
    userSelect: 'none', WebkitUserSelect: 'none',
    touchAction: 'pan-y',
  }

  // 万が一 node が undefined の場合のエラー防止
  if (!node) return null;

  return (
    <div>
      <div
        ref={rowRef}
        data-node-id={node.id}
        style={rowStyle}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <button
          style={{ background:'none', border:'none', cursor:'pointer', width:20, height:20, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:3, color:'inherit', flexShrink:0, padding:0, opacity:hasChildren?1:0, pointerEvents:hasChildren?'auto':'none', touchAction:'manipulation' }}
          onTouchStart={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onToggle(node.id) }}
        >
          <span style={{ display:'inline-block', transition:'transform 0.15s', transform:node.is_expanded?'rotate(90deg)':'rotate(0deg)', fontSize:10 }}>▶</span>
        </button>
        {/* ★ 修正：タイトルに getTitleStyle(node.title_style) を展開して適用 */}
        <span style={{ flex:1, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1, ...getTitleStyle(node.title_style) }}>
          {searchQuery ? renderHighlightedTitle(node.title, searchQuery) : node.title}
        </span>
        {/* ★ React のレンダリングエラーを防ぐため、三項演算子で安全に表示 */}
        {node.is_public ? <span style={{ fontSize: 12, marginLeft: 4, flexShrink: 0 }} title="公開中">🌐</span> : null}
        {isDragging ? <span style={{ fontSize:11, opacity:0.5, flexShrink:0 }}>✥</span> : null}
      </div>

      {node.is_expanded && hasChildren && (
        <div>
          {children.map(child => (
            <TreeNode
              key={child.id} node={child} nodes={nodes}
              selectedId={selectedId} onSelect={onSelect} onToggle={onToggle}
              draggingId={draggingId} dropTarget={dropTarget}
              onDragStart={onDragStart} onDragMove={onDragMove}
              onDragEnd={onDragEnd} onDragCancel={onDragCancel}
              depth={depth + 1}
              nodeLineHeight={nodeLineHeight}
            />
          ))}
        </div>
      )}
    </div>
  )
}