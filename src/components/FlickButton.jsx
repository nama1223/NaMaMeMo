/**
 * FlickButton v4
 *
 * - pointerDown で即ガイドラベル表示（押した瞬間から見える）
 * - 離した時点で方向が決まっていればフリック実行
 * - 移動量が FLICK_THRESHOLD 未満で離した → タップ判定 → onTap があれば実行、なければメニューを固定表示
 * - 固定メニュー表示中は各ラベルをクリックで実行、外側で閉じる
 */
import { useRef, useState, useCallback, useEffect } from 'react'

const FLICK_THRESHOLD = 22
const DIR_ARROWS = { up: '↑', down: '↓', left: '←', right: '→' }

function getLabelPos(dir) {
  return {
    up:    { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' },
    down:  { top:    'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' },
    left:  { right:  'calc(100% + 6px)', top: '50%',  transform: 'translateY(-50%)' },
    right: { left:   'calc(100% + 6px)', top: '50%',  transform: 'translateY(-50%)' },
  }[dir]
}

export default function FlickButton({ label, title, actions = {}, disabled, onTap }) {
  // 'idle' | 'pressing'（押下中・ガイド表示）| 'menu'（タップ後メニュー固定表示）
  const [uiState, setUiState] = useState('idle')
  const [activeDir, setActiveDir] = useState(null)

  const startPt = useRef(null)
  const fired = useRef(false)
  const btnRef = useRef(null)

  const dirs = Object.keys(actions).filter(d => ['up','down','left','right'].includes(d))

  // 外側クリックでメニューを閉じる
  useEffect(() => {
    if (uiState !== 'menu') return
    const handler = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setUiState('idle')
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [uiState])

  const getDir = useCallback((dx, dy) => {
    const ax = Math.abs(dx), ay = Math.abs(dy)
    if (ax < FLICK_THRESHOLD && ay < FLICK_THRESHOLD) return null
    if (ax > ay) return dx > 0 ? 'right' : 'left'
    return dy > 0 ? 'down' : 'up'
  }, [])

  const onPointerDown = useCallback((e) => {
    if (disabled) return
    if (uiState === 'menu') return
    e.currentTarget.setPointerCapture(e.pointerId)
    startPt.current = { x: e.clientX, y: e.clientY }
    fired.current = false
    setUiState('pressing')
    setActiveDir(null)
  }, [disabled, uiState])

  const onPointerMove = useCallback((e) => {
    if (uiState !== 'pressing' || !startPt.current) return
    const dx = e.clientX - startPt.current.x
    const dy = e.clientY - startPt.current.y
    setActiveDir(getDir(dx, dy))
  }, [uiState, getDir])

  const onPointerUp = useCallback((e) => {
    if (uiState !== 'pressing' || !startPt.current) return
    const dx = e.clientX - startPt.current.x
    const dy = e.clientY - startPt.current.y
    const dir = getDir(dx, dy)

    startPt.current = null
    setActiveDir(null)

    if (fired.current) { setUiState('idle'); return }
    fired.current = true

    if (dir && actions[dir] && !actions[dir].disabled) {
      // フリック実行
      setUiState('idle')
      actions[dir].onAction()
    } else {
      // タップ
      if (onTap) {
        // onTapが指定されている場合はそれを実行
        setUiState('idle')
        onTap()
      } else if (dirs.length > 0) {
        // メニューを固定表示に切り替え
        setUiState('menu')
      } else {
        setUiState('idle')
      }
    }
  }, [uiState, getDir, actions, dirs, onTap])

  const onPointerCancel = useCallback(() => {
    startPt.current = null
    setActiveDir(null)
    setUiState('idle')
    fired.current = true
  }, [])

  const execAction = useCallback((dir) => {
    const act = actions[dir]
    if (!act || act.disabled) return
    setUiState('idle')
    act.onAction()
  }, [actions])

  const isPressing = uiState === 'pressing'
  const isMenu = uiState === 'menu'

  return (
    <div ref={btnRef} style={{ position: 'relative', flex: 1, display: 'flex' }}>
      <button
        title={title}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          flex: 1,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 3, padding: '8px 2px',
          border: 'none', borderRight: '1px solid var(--border)',
          background: (isPressing || isMenu) ? 'var(--accent-bg)' : 'none',
          cursor: disabled ? 'default' : 'pointer',
          transition: 'background 0.1s',
          userSelect: 'none', WebkitUserSelect: 'none',
          touchAction: 'none', outline: 'none',
        }}
      >
        <span style={{
          fontSize: 15, lineHeight: 1,
          color: disabled ? 'var(--text-muted)' : (isMenu ? 'var(--accent)' : 'var(--text)'),
          opacity: disabled ? 0.35 : 1,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 9, whiteSpace: 'nowrap',
          color: isMenu ? 'var(--accent)' : 'var(--text-muted)',
          opacity: disabled ? 0.35 : 1,
        }}>
          {title}
        </span>
      </button>

      {/* 押下中（pressing）→ フリックガイドをアクティブ表示 */}
      {isPressing && dirs.map(dir => (
        <ActionLabel
          key={dir}
          dir={dir}
          active={activeDir === dir}
          disabled={actions[dir]?.disabled}
          label={actions[dir]?.label}
          clickable={false}
          onClick={null}
        />
      ))}

      {/* メニュー固定表示（menu）→ クリック可能 */}
      {isMenu && dirs.map(dir => (
        <ActionLabel
          key={dir}
          dir={dir}
          active={false}
          disabled={actions[dir]?.disabled}
          label={actions[dir]?.label}
          clickable={!actions[dir]?.disabled}
          onClick={() => execAction(dir)}
        />
      ))}
    </div>
  )
}

function ActionLabel({ dir, active, disabled, label, clickable, onClick }) {
  const pos = getLabelPos(dir)
  return (
    <div
      onPointerDown={clickable ? e => e.stopPropagation() : undefined}
      onClick={clickable && onClick ? onClick : undefined}
      style={{
        position: 'absolute', ...pos,
        minWidth: 72, padding: '8px 12px',
        borderRadius: 9,
        background: active
          ? (disabled ? '#999' : 'var(--accent)')
          : (disabled ? 'var(--surface)' : 'var(--bg)'),
        color: active ? 'white' : (disabled ? 'var(--text-muted)' : 'var(--text)'),
        border: `2px solid ${active ? 'transparent' : 'var(--border)'}`,
        boxShadow: active
          ? '0 3px 12px rgba(91,106,240,0.4)'
          : '0 2px 10px rgba(0,0,0,0.13)',
        fontSize: 12, fontWeight: 600,
        textAlign: 'center', whiteSpace: 'nowrap',
        zIndex: 200,
        pointerEvents: clickable ? 'auto' : 'none',
        cursor: clickable && !disabled ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        transition: 'background 0.1s, color 0.1s',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={{ fontSize: 16 }}>{DIR_ARROWS[dir]}</span>
      <span>{label || dir}</span>
    </div>
  )
}
