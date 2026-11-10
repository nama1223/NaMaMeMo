import { useEditor, EditorContent, Extension, Node } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useEffect, useCallback, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { supabase } from '../supabaseClient'
import { ALL_TOOLBAR_ITEMS } from '../hooks/useSettings'
import { TRASH_NODE_MARKER } from '../hooks/useNodes'

// ── FontSize ──
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: { fontSize: {
      default: null,
      parseHTML: el => el.style.fontSize || null,
      renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
    }}}]
  },
  addCommands() {
    return {
      setFontSize: (fs) => ({ chain }) => chain().setMark('textStyle', { fontSize: fs }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})

// ── Details（折りたたみ）──
// ネイティブ <details>/<summary> を使う方式。
// NodeView の複雑な実装を廃止し、ブラウザ標準の開閉に任せる。
// キーボードショートカットで Backspace での脱出を実装。
const DetailsSummary = Node.create({
  name: 'detailsSummary',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'summary' }] },
  renderHTML() {
    return ['summary', {}, 0]
  },
  addKeyboardShortcuts() {
    return {
      // summary の先頭で Backspace → details ごと削除
      Backspace: ({ editor }) => {
        const { $anchor } = editor.state.selection
        if ($anchor.parent.type.name !== 'detailsSummary') return false
        if ($anchor.parentOffset !== 0) return false
        if ($anchor.parent.textContent !== '') return false
        return editor.commands.deleteNode('details')
      },
      // Enter で summary を出て paragraph へ
      Enter: ({ editor }) => {
        const { $anchor } = editor.state.selection
        if ($anchor.parent.type.name !== 'detailsSummary') return false
        // カーソルを details の後に移動
        return editor.commands.exitCode()
      },
    }
  },
})

const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary block+',
  defining: true,
  addAttributes() {
    return { open: { default: true, parseHTML: el => el.hasAttribute('open'), renderHTML: attrs => attrs.open ? { open: '' } : {} } }
  },
  parseHTML() { return [{ tag: 'details' }] },
  renderHTML({ HTMLAttributes }) {
    return ['details', HTMLAttributes, 0]
  },
})

// ── FileAttachment ──
const FileAttachment = Node.create({
  name: 'fileAttachment', group: 'block', atom: true,
  addAttributes() {
    return {
      filename: { default: '', parseHTML: el => el.getAttribute('data-fa-filename') || '' },
      content: { default: '', parseHTML: el => {
        const b64 = el.getAttribute('data-fa-content') || ''
        try { return decodeURIComponent(atob(b64)) } catch { return b64 }
      }},
    }
  },
  parseHTML() { return [{ tag: 'div[data-file-attachment]' }] },
  renderHTML({ HTMLAttributes }) {
    const b64 = btoa(encodeURIComponent(HTMLAttributes.content || ''))
    return ['div', { 'data-file-attachment': '', 'data-fa-filename': HTMLAttributes.filename || '', 'data-fa-content': b64 }]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'file-attachment-node'
      dom.dataset.filename = node.attrs.filename
      dom.dataset.content = node.attrs.content
      dom.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:6px 12px;margin:4px 0;background:var(--surface,#f7f7f8);border:1px solid var(--border,#e5e5e7);border-radius:8px;cursor:pointer;font-size:13px;color:var(--text,#1a1a1a);max-width:280px;user-select:none;'
      dom.innerHTML = `<span style="font-size:18px">📄</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${node.attrs.filename}</span><span style="font-size:10px;color:#888">▶</span>`
      dom.addEventListener('click', (e) => {
        if (e.defaultPrevented) return
        dom.dispatchEvent(new CustomEvent('file-attachment-open', { bubbles: true, detail: { filename: node.attrs.filename, content: node.attrs.content } }))
      })
      return { dom }
    }
  },
})

const COLORS = ['#1a1a1a','#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c']
const HIGHLIGHTS = ['#fefcbf','#fed7d7','#c6f6d5','#bee3f8','#e9d8fd','#fbb6ce','#e2e8f0']
const FONT_SIZES = [10,11,12,13,14,15,16,18,20,24,28,32,36,48]
const TEXT_EXTS = new Set(['txt','md','csv','json','xml','yaml','yml','js','jsx','ts','tsx','css','scss','less','html','htm','py','rb','php','java','c','cpp','h','cs','go','rs','swift','sh','bash','zsh','bat','cmd','ps1','ini','conf','cfg','toml','env','log','jsc','mjs','cjs','vue','svelte'])
const isTextFile = f => TEXT_EXTS.has((f.name.split('.').pop()||'').toLowerCase()) || f.type.startsWith('text/')

function getCurrentFontSize(editor) {
  const attrs = editor.getAttributes('textStyle')
  return attrs.fontSize ? parseInt(attrs.fontSize) : null
}

function withScrollLock(scrollEl, fn) {
  if (!scrollEl) { fn(); return }
  const top = scrollEl.scrollTop
  fn()
  requestAnimationFrame(() => {
    scrollEl.scrollTop = top
    requestAnimationFrame(() => { scrollEl.scrollTop = top })
  })
}

function compressImage(src, quality = 0.7, maxWidth = 1280) {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h })
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

const RichEditor = forwardRef(function RichEditor(
  { node, onUpdateContent, userId, toolbarCollapsed, onTextFileDrop, settings },
  ref
) {
  const defaultFontSize = settings?.defaultFontSize || 15
  const lineHeight = settings?.lineHeight || 1.6
  const isTrash = node?.content?.includes(TRASH_NODE_MARKER) ?? false

  const enabledItems = (() => {
    const raw = settings?.enabledToolbarItems
    if (!raw || !Array.isArray(raw) || raw.length === 0) return ALL_TOOLBAR_ITEMS.map(i => i.id)
    return raw.map(i => (typeof i === 'string' ? i : i?.id)).filter(Boolean)
  })()

  const saveTimer = useRef(null)
  const [saving, setSaving] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [fileViewer, setFileViewer] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [compressDialog, setCompressDialog] = useState(null)
  const [moveMode, setMoveMode] = useState(null)
  const [, forceUpdate] = useState(0)
  const wrapperRef = useRef(null)
  const editorAreaRef = useRef(null)
  const contextMenuRef = useRef(null)
  const [undoDepth, setUndoDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
  const isSyncingRef = useRef(false)

  const updateHistoryState = useCallback((ed) => {
    if (!ed) return
    try {
      const hist = ed.state['history$']
      if (hist) { setUndoDepth(hist.done?.eventCount || 0); setRedoDepth(hist.undone?.eventCount || 0) }
    } catch {}
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle, FontSize, Color, Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false, allowBase64: false }),
      TaskList, TaskItem.configure({ nested: true }),
      DetailsSummary, Details,
      FileAttachment,
    ],
    content: node?.content || '',
    editable: !isTrash,
    onUpdate: ({ editor }) => {
      if (isSyncingRef.current || isTrash) return
      forceUpdate(n => n + 1)
      updateHistoryState(editor)
      const html = editor.getHTML()
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        setSaving(true)
        await onUpdateContent(node.id, html)
        setSaving(false)
      }, 1000)
    },
    onSelectionUpdate: ({ editor }) => {
      if (isSyncingRef.current) return
      forceUpdate(n => n + 1)
      updateHistoryState(editor)
    },
    editorProps: {
      scrollThreshold: { top: 9999, bottom: 9999, left: 9999, right: 9999 },
      scrollMargin: { top: 0, bottom: 0, left: 0, right: 0 },
      handleScrollToSelection: () => true,
      attributes: {
        style: `outline:none; padding: 20px 24px; min-height: 200px; font-size: ${defaultFontSize}px; line-height: ${lineHeight};`,
      },
      handlePaste(view, event) {
        if (isTrash) return false
        const items = event.clipboardData?.items; if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault(); const f = item.getAsFile(); if (f) handleImageFile(f); return true
          }
        }
        return false
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!isTrash)
  }, [editor, isTrash])

  useEffect(() => {
    const el = wrapperRef.current; if (!el) return
    const handler = e => setFileViewer(e.detail)
    el.addEventListener('file-attachment-open', handler)
    return () => el.removeEventListener('file-attachment-open', handler)
  }, [])

  const handleEditorClickForMove = useCallback((e) => {
    if (!moveMode || !editor) return
    e.preventDefault(); e.stopPropagation()
    let deleted = false
    editor.state.doc.descendants((n, pos) => {
      if (deleted) return false
      if (n.type.name === 'fileAttachment' && n.attrs.filename === moveMode.filename) {
        deleted = true
        editor.chain().command(({ tr }) => { tr.delete(pos, pos + n.nodeSize); return true }).run()
      }
    })
    editor.chain().focus().insertContent({ type: 'fileAttachment', attrs: { filename: moveMode.filename, content: moveMode.content } }).run()
    setMoveMode(null)
  }, [moveMode, editor])

  useEffect(() => {
    if (!editor || !node) return
    const current = editor.getHTML()
    const incoming = node.content || ''
    if (current === incoming) return
    const scrollEl = editorAreaRef.current
    const savedTop = scrollEl?.scrollTop ?? 0
//カーソル位置を記憶
    const { from, to } = editor.state.selection
    isSyncingRef.current = true
    editor.commands.setContent(incoming, false, { preserveWhitespace: 'full' })
    isSyncingRef.current = false
// カーソル位置を復元 ※文字数が減ってエラーになるのを防ぐため、ドキュメントの最大サイズ内に収める安全対策
    const docSize = editor.state.doc.content.size
    editor.commands.setTextSelection({
      from: Math.min(from, docSize),
      to: Math.min(to, docSize)
    })
    requestAnimationFrame(() => { if (scrollEl) scrollEl.scrollTop = savedTop })
  }, [node?.content])

  useImperativeHandle(ref, () => ({
    insertText: (text) => { if (!editor || isTrash) return; editor.chain().focus().insertContent(text).run() },
    insertFileAttachment: (filename, content) => { if (!editor || isTrash) return; editor.chain().focus().insertContent({ type: 'fileAttachment', attrs: { filename, content } }).run() },
  }), [editor, isTrash])

  const handleImageFile = useCallback(async (file) => {
    if (!userId || !editor || isTrash) return; setImageUploading(true)
    try {
      const ext = file.name.split('.').pop(), path = `${userId}/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('images').upload(path, file, { contentType: file.type })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('images').getPublicUrl(path)
      withScrollLock(editorAreaRef.current, () => editor.commands.setImage({ src: data.publicUrl }))
    } catch (e) { alert('画像のアップロードに失敗しました: ' + e.message) }
    finally { setImageUploading(false) }
  }, [userId, editor, isTrash])

  const handleFile = useCallback(async (file) => {
    if (isTrash) return
    if (file.type.startsWith('image/')) await handleImageFile(file)
    else if (isTextFile(file)) { const text = await file.text(); onTextFileDrop?.(file, text) }
    else alert(`「${file.name}」は対応していないファイル形式です`)
  }, [handleImageFile, onTextFileDrop, isTrash])

  const handleImageSelect = useCallback(() => {
    if (isTrash) return
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'
    input.onchange = e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }; input.click()
  }, [handleImageFile, isTrash])

  const changeFontSize = useCallback((delta) => {
    if (!editor || isTrash) return
    const { from, to } = editor.state.selection
    const current = getCurrentFontSize(editor) || defaultFontSize
    const idx = FONT_SIZES.indexOf(current)
    let nextIdx = idx === -1 ? FONT_SIZES.indexOf(FONT_SIZES.reduce((p,c) => Math.abs(c-current)<Math.abs(p-current)?c:p)) + delta : idx + delta
    nextIdx = Math.max(0, Math.min(FONT_SIZES.length-1, nextIdx))
    withScrollLock(editorAreaRef.current, () => {
      editor.chain().focus().setFontSize(`${FONT_SIZES[nextIdx]}px`).run()
      if (from !== to) editor.commands.setTextSelection({ from, to })
    })
  }, [editor, defaultFontSize, isTrash])

  const toggleCodeBlockSmart = useCallback(() => {
    if (!editor || isTrash) return
    withScrollLock(editorAreaRef.current, () => {
      const { from, to } = editor.state.selection
      if (from === to) { editor.chain().focus().toggleCodeBlock().run(); return }
      const selectedText = editor.state.doc.textBetween(from, to, '\n')
      if (editor.isActive('codeBlock')) editor.chain().focus().toggleCodeBlock().run()
      else editor.chain().focus().deleteSelection().insertContent({ type: 'codeBlock', content: [{ type: 'text', text: selectedText }] }).run()
    })
  }, [editor, isTrash])

  // ── コンテキストメニュー（右クリック / スマホ長押し）──
  const openContextMenu = useCallback((x, y, data) => {
    // スマホでキーボードを閉じる
    if (document.activeElement) document.activeElement.blur()
    setContextMenu({ x, y, ...data })
  }, [])

  useEffect(() => {
    const el = wrapperRef.current; if (!el) return

    const onContextMenu = (e) => {
      const img = e.target.closest('.tiptap img'), fa = e.target.closest('.file-attachment-node')
      if (img) { e.preventDefault(); openContextMenu(e.clientX, e.clientY, { type: 'image', src: img.src }) }
      else if (fa) { e.preventDefault(); openContextMenu(e.clientX, e.clientY, { type: 'file', filename: fa.dataset.filename, content: fa.dataset.content }) }
    }

    let longPressTimer = null
    let lpTouch = null
    const onTouchStart = (e) => {
      const img = e.target.closest('.tiptap img'), fa = e.target.closest('.file-attachment-node')
      if (!img && !fa) return
      e.preventDefault() // テキスト選択・フォーカス抑制
      const touch = e.touches[0]
      lpTouch = { img, fa, x: touch.clientX, y: touch.clientY }
      longPressTimer = setTimeout(() => {
        if (!lpTouch) return
        if (lpTouch.img) openContextMenu(lpTouch.x, lpTouch.y, { type: 'image', src: lpTouch.img.src })
        else if (lpTouch.fa) openContextMenu(lpTouch.x, lpTouch.y, { type: 'file', filename: lpTouch.fa.dataset.filename, content: lpTouch.fa.dataset.content })
        lpTouch = null
      }, 500)
    }
    const onTouchEnd = () => { clearTimeout(longPressTimer); lpTouch = null }
    const onTouchMove = () => { clearTimeout(longPressTimer); lpTouch = null }

    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchmove', onTouchMove)
    return () => {
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [openContextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const close = (e) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target)) return
      setContextMenu(null)
    }
    const tid = setTimeout(() => { document.addEventListener('pointerdown', close, true) }, 80)
    return () => { clearTimeout(tid); document.removeEventListener('pointerdown', close, true) }
  }, [contextMenu])

  const onDragOver = useCallback((e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setIsDragOver(true) }, [])
  const onDragLeave = useCallback((e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }, [])
  const onDrop = useCallback(async (e) => {
    if (isTrash) return
    e.preventDefault(); setIsDragOver(false)
    for (const file of Array.from(e.dataTransfer.files)) await handleFile(file)
  }, [handleFile, isTrash])

  const onEditorAreaClick = useCallback((e) => {
    if (moveMode) { handleEditorClickForMove(e); return }
    if (!editor || e.target.closest('.ProseMirror')) return
    withScrollLock(editorAreaRef.current, () => editor.commands.focus('end'))
  }, [editor, moveMode, handleEditorClickForMove])

  const onToolbarMouseDown = useCallback((e) => { if (e.target.tagName !== 'INPUT') e.preventDefault() }, [])
  const onToolbarTouchStart = useCallback((e) => { if (e.target.tagName !== 'INPUT') e.preventDefault() }, [])

  const sl = useCallback((fn) => () => {
    if (!editor || isTrash) return
    const { from, to } = editor.state.selection
    withScrollLock(editorAreaRef.current, fn)
    if (from !== to) {
      requestAnimationFrame(() => {
        editor.commands.focus()
        editor.commands.setTextSelection({ from, to })
      })
    }
  }, [editor, isTrash])

  // 折りたたみブロック挿入（選択テキストを取り込む）
  const insertDetails = useCallback(() => {
    if (!editor || isTrash) return
    withScrollLock(editorAreaRef.current, () => {
      if (editor.isActive('details')) { editor.chain().focus().lift('details').run(); return }
      const { from, to } = editor.state.selection
      const hasSelection = from !== to
      const selectedText = hasSelection ? editor.state.doc.textBetween(from, to, '\n') : ''
      const bodyContent = selectedText
        ? [{ type: 'paragraph', content: [{ type: 'text', text: selectedText }] }]
        : [{ type: 'paragraph', content: [{ type: 'text', text: '本文をここに入力' }] }]

      if (hasSelection) {
        editor.chain().focus().deleteSelection().insertContent({
          type: 'details', attrs: { open: true },
          content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'タイトルをここに入力' }] }, ...bodyContent],
        }).run()
      } else {
        editor.chain().focus().insertContent({
          type: 'details', attrs: { open: true },
          content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'タイトルをここに入力' }] }, ...bodyContent],
        }).run()
      }
    })
  }, [editor, isTrash])

  if (!editor) return null
  const currentFontSize = getCurrentFontSize(editor) || defaultFontSize
  const isAlign = a => editor.isActive({ textAlign: a })

  const TOOLBAR_RENDERERS = {
    fontSize: () => (
      <ToolGroup key="fontSize">
        <ToolBtn onClick={() => changeFontSize(-1)} title="文字を小さく" disabled={currentFontSize <= FONT_SIZES[0] || isTrash}><span style={{fontSize:11}}>A</span><span style={{fontSize:8}}>▼</span></ToolBtn>
        <span style={styles.sizeLabel}>{currentFontSize}</span>
        <ToolBtn onClick={() => changeFontSize(1)} title="文字を大きく" disabled={currentFontSize >= FONT_SIZES[FONT_SIZES.length-1] || isTrash}><span style={{fontSize:15}}>A</span><span style={{fontSize:8}}>▲</span></ToolBtn>
      </ToolGroup>
    ),
    undo: () => <ToolGroup key="undo"><UndoRedoBtn editor={editor} type="undo" depth={undoDepth} editorAreaRef={editorAreaRef} disabled={isTrash} /></ToolGroup>,
    redo: () => <ToolGroup key="redo"><UndoRedoBtn editor={editor} type="redo" depth={redoDepth} editorAreaRef={editorAreaRef} disabled={isTrash} /></ToolGroup>,
    bold: () => <ToolBtn key="bold" active={editor.isActive('bold')} onClick={sl(() => editor.chain().focus().toggleBold().run())} title="太字" disabled={isTrash} extraStyle={{fontWeight:900}}>B</ToolBtn>,
    italic: () => <ToolBtn key="italic" active={editor.isActive('italic')} onClick={sl(() => editor.chain().focus().toggleItalic().run())} title="斜体" disabled={isTrash} extraStyle={{fontStyle:'italic',fontWeight:700}}>I</ToolBtn>,
    underline: () => <ToolBtn key="underline" active={editor.isActive('underline')} onClick={sl(() => editor.chain().focus().toggleUnderline().run())} title="下線" disabled={isTrash} extraStyle={{textDecoration:'underline'}}>U</ToolBtn>,
    strike: () => <ToolBtn key="strike" active={editor.isActive('strike')} onClick={sl(() => editor.chain().focus().toggleStrike().run())} title="取り消し線" disabled={isTrash} extraStyle={{textDecoration:'line-through'}}>S</ToolBtn>,
    color: () => (
      <ToolGroup key="color">
        {COLORS.map(color => <button key={color} title="文字色" disabled={isTrash} style={{...styles.colorBtn, background:color, outline:editor.isActive('textStyle',{color})?'2px solid var(--accent)':'1px solid rgba(0,0,0,0.15)', outlineOffset:1, opacity:isTrash?0.4:1, cursor:isTrash?'default':'pointer'}} onMouseDown={e=>{e.preventDefault();if(!isTrash)sl(() => editor.chain().focus().setColor(color).run())()} } onTouchStart={e=>{e.preventDefault();if(!isTrash)sl(() => editor.chain().focus().setColor(color).run())()} } />)}
      </ToolGroup>
    ),
    highlight: () => (
      <ToolGroup key="highlight">
        {HIGHLIGHTS.map(color => <button key={color} title="ハイライト" disabled={isTrash} style={{...styles.colorBtn, background:color, outline:editor.isActive('highlight',{color})?'2px solid var(--accent)':'1px solid rgba(0,0,0,0.15)', outlineOffset:1, opacity:isTrash?0.4:1, cursor:isTrash?'default':'pointer'}} onMouseDown={e=>{e.preventDefault();if(!isTrash)sl(() => editor.chain().focus().toggleHighlight({color}).run())()} } onTouchStart={e=>{e.preventDefault();if(!isTrash)sl(() => editor.chain().focus().toggleHighlight({color}).run())()} } />)}
      </ToolGroup>
    ),
    align: () => (
      <ToolGroup key="align">
        <ToolBtn active={isAlign('left')} onClick={sl(() => editor.chain().focus().setTextAlign('left').run())} title="左揃え" disabled={isTrash}><AlignIcon type="left" /></ToolBtn>
        <ToolBtn active={isAlign('center')} onClick={sl(() => editor.chain().focus().setTextAlign('center').run())} title="中央揃え" disabled={isTrash}><AlignIcon type="center" /></ToolBtn>
        <ToolBtn active={isAlign('right')} onClick={sl(() => editor.chain().focus().setTextAlign('right').run())} title="右揃え" disabled={isTrash}><AlignIcon type="right" /></ToolBtn>
      </ToolGroup>
    ),
    bulletList: () => <ToolBtn key="bulletList" active={editor.isActive('bulletList')} onClick={sl(() => editor.chain().focus().toggleBulletList().run())} title="箇条書き" disabled={isTrash} extraStyle={{fontSize:14}}>≡</ToolBtn>,
    orderedList: () => <ToolBtn key="orderedList" active={editor.isActive('orderedList')} onClick={sl(() => editor.chain().focus().toggleOrderedList().run())} title="番号付きリスト" disabled={isTrash} extraStyle={{fontSize:11,fontWeight:700}}>1.</ToolBtn>,
    taskList: () => <ToolBtn key="taskList" active={editor.isActive('taskList')} onClick={sl(() => editor.chain().focus().toggleTaskList().run())} title="チェックボックス" disabled={isTrash} extraStyle={{fontSize:13}}>☑</ToolBtn>,
    blockquote: () => <ToolBtn key="blockquote" active={editor.isActive('blockquote')} onClick={sl(() => editor.chain().focus().toggleBlockquote().run())} title="引用" disabled={isTrash} extraStyle={{fontSize:14}}>❝</ToolBtn>,
    codeBlock: () => <ToolBtn key="codeBlock" active={editor.isActive('codeBlock')} onClick={toggleCodeBlockSmart} title="コードブロック" disabled={isTrash} extraStyle={{fontSize:10,fontFamily:'monospace'}}>{`</>`}</ToolBtn>,
    details: () => <ToolBtn key="details" active={editor.isActive('details')} onClick={insertDetails} title="折りたたみブロック" disabled={isTrash} extraStyle={{fontSize:13}}>▾</ToolBtn>,
    image: () => <ToolBtn key="image" onClick={handleImageSelect} title="画像を挿入" disabled={imageUploading || isTrash} extraStyle={{fontSize:15}}>{imageUploading?'⏳':'🖼'}</ToolBtn>,
  }

  const GROUP_IDS = new Set(['bold','italic','underline','strike','bulletList','orderedList','taskList','blockquote','codeBlock','details','image'])
  const toolbarElements = []
  let groupBuffer = []

  enabledItems.forEach((id, idx) => {
    const renderer = TOOLBAR_RENDERERS[id]
    if (!renderer) return
    const isGroupable = GROUP_IDS.has(id)
    if (isGroupable) {
      groupBuffer.push(renderer())
    } else {
      if (groupBuffer.length > 0) {
        toolbarElements.push(<ToolGroup key={`group-${idx}`}>{groupBuffer}</ToolGroup>)
        toolbarElements.push(<Divider key={`div-${idx}-a`} />)
        groupBuffer = []
      } else if (toolbarElements.length > 0) {
        toolbarElements.push(<Divider key={`div-${idx}`} />)
      }
      toolbarElements.push(renderer())
    }
  })
  if (groupBuffer.length > 0) {
    if (toolbarElements.length > 0) toolbarElements.push(<Divider key="div-last" />)
    toolbarElements.push(<ToolGroup key="group-last">{groupBuffer}</ToolGroup>)
  }

  return (
    <div
      ref={wrapperRef}
      style={{ ...styles.wrapper, outline: isDragOver ? '3px solid var(--accent)' : 'none', outlineOffset: -3, cursor: moveMode ? 'crosshair' : undefined }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      onClick={onEditorAreaClick}
    >
      {isDragOver && (
        <div style={styles.dropOverlay}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, color:'white' }}>
            <span style={{fontSize:32}}>📂</span><span style={{fontSize:15,fontWeight:600}}>ここにドロップ</span>
          </div>
        </div>
      )}

      {moveMode && (
        <div style={styles.moveModeBar}>
          <span>📄 「{moveMode.filename}」を移動 — 移動先をタップ</span>
          <button style={styles.moveModeCancel} onMouseDown={e=>e.preventDefault()} onClick={() => setMoveMode(null)}>キャンセル</button>
        </div>
      )}

      {!toolbarCollapsed && !isTrash && (
        <div style={styles.toolbar} onMouseDown={onToolbarMouseDown} onTouchStart={onToolbarTouchStart}>
          {toolbarElements}
          <span style={styles.savingLabel}>{saving ? '保存中…' : ''}</span>
        </div>
      )}

      {toolbarCollapsed && saving && !isTrash && <div style={styles.savingBar}>保存中…</div>}

      {isTrash && (
        <div style={styles.trashReadonlyBar}>
          🗑 このノードはごみ箱内のため読み取り専用です
        </div>
      )}

      <div ref={editorAreaRef} style={{ ...styles.editorArea, ...(isTrash ? styles.editorAreaTrash : {}) }}>
        <EditorContent editor={editor} style={{ minHeight: '100%' }} />
      </div>

      <ImageModal />

      {fileViewer && (
        <div style={styles.fileViewerOverlay} onClick={() => setFileViewer(null)}>
          <div style={styles.fileViewer} onClick={e => e.stopPropagation()}>
            <div style={styles.fileViewerHeader}>
              <span style={styles.fileViewerTitle}>📄 {fileViewer.filename}</span>
              <button style={styles.fileViewerClose} onClick={() => setFileViewer(null)}>✕</button>
            </div>
            <pre style={styles.fileViewerContent}>{fileViewer.content}</pre>
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          menuRef={contextMenuRef}
          menu={contextMenu}
          editor={editor}
          editorAreaRef={editorAreaRef}
          onClose={() => setContextMenu(null)}
          onStartMove={(filename, content) => { setContextMenu(null); setMoveMode({ filename, content }) }}
          onStartCompress={(src) => {
            setContextMenu(null)
            compressImage(src, 0.7).then(result => {
              if (!result) return
              fetch(src).then(r => r.blob()).then(blob => {
                setCompressDialog({ originalSrc: src, compressedDataUrl: result.dataUrl, originalSize: blob.size, compressedSize: Math.round(result.dataUrl.length * 0.75) })
              }).catch(() => {
                setCompressDialog({ originalSrc: src, compressedDataUrl: result.dataUrl, originalSize: null, compressedSize: Math.round(result.dataUrl.length * 0.75) })
              })
            })
          }}
        />
      )}

      {compressDialog && (
        <CompressDialog dialog={compressDialog} editor={editor} editorAreaRef={editorAreaRef} userId={userId} onClose={() => setCompressDialog(null)} />
      )}
    </div>
  )
})

export default RichEditor

// ── 画像圧縮 ──
function CompressDialog({ dialog, editor, editorAreaRef, userId, onClose }) {
  const [applying, setApplying] = useState(false)
  const fmt = (b) => b == null ? '不明' : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(2)} MB`
  const saving = dialog.originalSize ? Math.round((1 - dialog.compressedSize / dialog.originalSize) * 100) : null

  const handleApply = async () => {
    setApplying(true)
    try {
      const res = await fetch(dialog.compressedDataUrl)
      const blob = await res.blob()
      const path = `${userId}/${Date.now()}_compressed.jpg`
      const { error } = await supabase.storage.from('images').upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      const { data } = supabase.storage.from('images').getPublicUrl(path)
      const newSrc = data.publicUrl
      let replaced = false
      editor.state.doc.descendants((node, pos) => {
        if (replaced || node.type.name !== 'image' || node.attrs.src !== dialog.originalSrc) return
        replaced = true
        withScrollLock(editorAreaRef.current, () => {
          editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newSrc }); return true }).run()
        })
      })
      onClose()
    } catch (e) { alert('圧縮画像の保存に失敗: ' + e.message) }
    setApplying(false)
  }

  return (
    <div style={styles.fileViewerOverlay} onClick={onClose}>
      <div style={{ background:'var(--bg)', borderRadius:14, width:'90vw', maxWidth:600, boxShadow:'0 16px 48px rgba(0,0,0,0.3)', overflow:'hidden' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px 10px', borderBottom:'1px solid var(--border)' }}>
          <span style={{ fontSize:15, fontWeight:700, color:'var(--text)' }}>🖼 画像を圧縮</span>
          <button style={{ background:'none', border:'none', fontSize:14, cursor:'pointer', color:'var(--text-muted)' }} onClick={onClose}>✕</button>
        </div>
        <div style={{ display:'flex', gap:12, padding:16 }}>
          <div style={{ flex:1, textAlign:'center' }}>
            <p style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>Before（元の画像）</p>
            <img src={dialog.originalSrc} alt="元" style={{ maxWidth:'100%', maxHeight:200, objectFit:'contain', borderRadius:6, border:'1px solid var(--border)' }} />
            <p style={{ fontSize:12, color:'var(--text)', marginTop:6 }}>{fmt(dialog.originalSize)}</p>
          </div>
          <div style={{ flex:1, textAlign:'center' }}>
            <p style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>After（JPEG 70%品質）</p>
            <img src={dialog.compressedDataUrl} alt="圧縮後" style={{ maxWidth:'100%', maxHeight:200, objectFit:'contain', borderRadius:6, border:'1px solid var(--border)' }} />
            <p style={{ fontSize:12, color:'var(--text)', marginTop:6 }}>{fmt(dialog.compressedSize)}{saving != null && <span style={{ color:'#38a169', marginLeft:6 }}>▼{saving}%削減</span>}</p>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, padding:'0 16px 16px', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, fontSize:13, cursor:'pointer', color:'var(--text)' }}>キャンセル</button>
          <button onClick={handleApply} disabled={applying} style={{ padding:'8px 20px', background:'var(--accent)', border:'none', borderRadius:8, fontSize:13, cursor:'pointer', color:'white', fontWeight:600 }}>
            {applying ? '適用中…' : 'この画質で保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function UndoRedoBtn({ editor, type, depth, editorAreaRef, disabled }) {
  if (!editor) return null
  const can = !disabled && (type === 'undo' ? editor.can().undo() : editor.can().redo())
  const icon = type === 'undo' ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6"/><path d="M3 13C5.33 8.9 9.5 6 14 6c4.42 0 8 3.58 8 8s-3.58 8-8 8c-3 0-5.65-1.65-7.09-4.1"/>
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6"/><path d="M21 13C18.67 8.9 14.5 6 10 6c-4.42 0-8 3.58-8 8s3.58 8 8 8c3 0 5.65-1.65 7.09-4.1"/>
    </svg>
  )
  return (
    <button title={type === 'undo' ? '元に戻す' : 'やり直し'} disabled={!can}
      onMouseDown={e => e.preventDefault()}
      onClick={() => withScrollLock(editorAreaRef.current, () => { type==='undo' ? editor.chain().focus().undo().run() : editor.chain().focus().redo().run() })}
      style={{ ...styles.toolBtn, background:'transparent', color:can?'var(--text)':'var(--text-muted)', opacity:can?1:0.4, position:'relative', width:32 }}
    >
      {icon}
      {depth > 0 && <span style={{ position:'absolute', bottom:0, right:0, fontSize:8, fontWeight:700, color:can?'var(--accent)':'var(--text-muted)', lineHeight:1 }}>{depth}</span>}
    </button>
  )
}

// ── コンテキストメニュー ──
function ContextMenu({ menuRef, menu, editor, editorAreaRef, onClose, onStartMove, onStartCompress }) {
  const { x, y, type, src, filename, content } = menu
  const menuX = Math.min(x, window.innerWidth - 210)
  const menuY = Math.min(y, window.innerHeight - 280)

  // onMouseDown/onTouchStart で実行（onClick より先に発火）
  const makeHandler = (fn) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    fn()
    onClose()
  }

  // 画像ダウンロード：fetch して Blob でダウンロード（新しいタブを開かない）
  const downloadImage = async () => {
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const ext = blob.type.split('/')[1] || 'jpg'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `image.${ext}`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // CORS で fetch できない場合は新しいタブで開く
      window.open(src, '_blank')
    }
  }

  const downloadFile = () => {
    const blob = new Blob([content || ''], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename || 'file.txt'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const adjustImageSize = (delta) => {
    if (!editor || type !== 'image') return
    let adjusted = false
    editor.state.doc.descendants((node, pos) => {
      if (adjusted || node.type.name !== 'image' || node.attrs.src !== src) return
      adjusted = true
      // style から現在幅を取得（なければコンテナ幅を基準に）
      let curWidth = 300
      if (node.attrs.style) {
        const m = node.attrs.style.match(/max-width:\s*(\d+)px/)
        if (m) curWidth = parseInt(m[1])
      } else if (node.attrs.width) {
        curWidth = parseInt(node.attrs.width) || 300
      }
      // コンテナ幅上限を取得
      const containerWidth = editorAreaRef.current?.clientWidth || 800
      const newWidth = Math.max(50, Math.min(containerWidth - 48, curWidth + delta))
      withScrollLock(editorAreaRef.current, () => {
        editor.chain().command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: newWidth, style: `max-width:${newWidth}px;width:${newWidth}px;` })
          return true
        }).run()
      })
    })
  }

  const deleteNode = () => {
    if (!editor) return
    let deleted = false
    editor.state.doc.descendants((node, pos) => {
      if (deleted) return false
      const match = type === 'image'
        ? node.type.name === 'image' && node.attrs.src === src
        : node.type.name === 'fileAttachment' && node.attrs.filename === filename
      if (match) {
        deleted = true
        withScrollLock(editorAreaRef.current, () => {
          editor.chain().command(({ tr }) => { tr.delete(pos, pos + node.nodeSize); return true }).run()
        })
      }
    })
  }

  // 「移動」は type に関係なくファイル添付のみ（画像は位置固定）
  const items = [
    { label: '⬇ ダウンロード', action: type === 'image' ? downloadImage : downloadFile },
    ...(type === 'image' ? [
      { label: '🔍− 縮小 (−80px)', action: () => adjustImageSize(-80) },
      { label: '🔍+ 拡大 (+80px)', action: () => adjustImageSize(+80) },
      { label: '🗜 画質を下げて容量削減', action: () => onStartCompress(src) },
    ] : [
      // 「移動」は常に表示（スマホ・PC問わず）
      { label: '📌 移動', action: () => onStartMove(filename, content) },
    ]),
    { label: '🗑 削除', action: deleteNode, danger: true },
  ]

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left: menuX, top: menuY, zIndex: 500,
        background: 'var(--bg)', border: '1.5px solid var(--border)',
        borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        overflow: 'hidden', minWidth: 200,
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onMouseDown={makeHandler(item.action)}
          onTouchStart={makeHandler(item.action)}
          style={{
            display: 'block', width: '100%', padding: '12px 16px',
            background: 'none', border: 'none',
            borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
            textAlign: 'left', fontSize: 14, cursor: 'pointer',
            color: item.danger ? '#dc2626' : 'var(--text)',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function AlignIcon({ type }) {
  const configs = { left:[{x:2,w:16},{x:2,w:11},{x:2,w:16},{x:2,w:9}], center:[{x:2,w:16},{x:5,w:10},{x:2,w:16},{x:6,w:8}], right:[{x:2,w:16},{x:7,w:11},{x:2,w:16},{x:9,w:9}] }[type]
  return (<svg width="18" height="14" viewBox="0 0 20 16" fill="currentColor">{configs.map((l,i)=><rect key={i} x={l.x} y={i*4} width={l.w} height={2} rx={1}/>)}</svg>)
}

function ImageModal() {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    const h = e => { if (e.target.tagName==='IMG'&&e.target.closest('.tiptap')&&e.button===0) setSrc(e.target.src) }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [])
  if (!src) return null
  return (
    <div style={styles.modal} onClick={() => setSrc(null)}>
      <img src={src} alt="" style={styles.modalImg} onClick={e=>e.stopPropagation()} />
      <button style={styles.modalClose} onClick={() => setSrc(null)}>✕</button>
    </div>
  )
}

function ToolBtn({ children, active, onClick, title, disabled, extraStyle }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      style={{...styles.toolBtn,...extraStyle, background:active?'var(--accent-bg)':'transparent', color:active?'var(--accent)':'var(--text)', opacity:disabled?0.4:1}}
    >
      {children}
    </button>
  )
}
function ToolGroup({ children }) { return <div style={styles.toolGroup}>{children}</div> }
function Divider() { return <div style={styles.divider} /> }

const styles = {
  wrapper: { display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', position:'relative' },
  toolbar: { display:'flex', alignItems:'center', flexWrap:'wrap', gap:2, padding:'5px 10px', borderBottom:'1px solid var(--border)', background:'var(--surface)', flexShrink:0 },
  savingBar: { padding:'3px 12px', fontSize:11, color:'var(--text-muted)', background:'var(--surface)', borderBottom:'1px solid var(--border)', flexShrink:0 },
  trashReadonlyBar: { padding:'6px 16px', fontSize:12, color:'#92400e', background:'#fef3c7', borderBottom:'1px solid #fcd34d', flexShrink:0 },
  toolGroup: { display:'flex', alignItems:'center', gap:1 },
  toolBtn: { border:'none', borderRadius:5, width:28, height:26, cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center', transition:'background 0.1s', flexShrink:0, padding:0 },
  sizeLabel: { fontSize:11, color:'var(--text-muted)', minWidth:22, textAlign:'center', fontVariantNumeric:'tabular-nums' },
  colorBtn: { width:15, height:15, borderRadius:3, border:'none', cursor:'pointer', flexShrink:0, margin:'0 1px' },
  divider: { width:1, height:18, background:'var(--border)', margin:'0 3px', flexShrink:0 },
  savingLabel: { marginLeft:'auto', fontSize:11, color:'var(--text-muted)' },
  editorArea: { flex:1, overflowY:'auto', cursor:'text' },
  editorAreaTrash: { opacity:0.55, cursor:'default', userSelect:'text', pointerEvents:'none' },
  dropOverlay: { position:'absolute', inset:0, background:'rgba(91,106,240,0.82)', zIndex:30, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' },
  moveModeBar: { display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding:'6px 12px', background:'#fef3c7', borderBottom:'1px solid #fcd34d', fontSize:12, color:'#92400e', flexShrink:0 },
  moveModeCancel: { padding:'3px 10px', background:'white', border:'1px solid #fcd34d', borderRadius:5, fontSize:12, cursor:'pointer', color:'#92400e', flexShrink:0 },
  modal: { position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', cursor:'zoom-out' },
  modalImg: { maxWidth:'90vw', maxHeight:'90vh', objectFit:'contain', borderRadius:8, boxShadow:'0 8px 40px rgba(0,0,0,0.5)' },
  modalClose: { position:'absolute', top:20, right:20, background:'rgba(255,255,255,0.15)', border:'none', color:'white', width:36, height:36, borderRadius:'50%', fontSize:16, cursor:'pointer' },
  fileViewerOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' },
  fileViewer: { background:'var(--bg)', borderRadius:12, width:'80vw', maxWidth:640, maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,0.3)', overflow:'hidden' },
  fileViewerHeader: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--border)', flexShrink:0 },
  fileViewerTitle: { fontSize:14, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  fileViewerClose: { background:'none', border:'none', fontSize:15, cursor:'pointer', color:'var(--text-muted)', width:28, height:28, borderRadius:4, flexShrink:0 },
  fileViewerContent: { flex:1, overflowY:'auto', padding:'16px', margin:0, fontSize:12, lineHeight:1.6, fontFamily:'ui-monospace,SFMono-Regular,monospace', color:'var(--text)', whiteSpace:'pre-wrap', wordBreak:'break-all', background:'var(--surface)' },
}
