import { useEditor, EditorContent, Extension, Node, ReactRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import CharacterCount from '@tiptap/extension-character-count'
import Mention from '@tiptap/extension-mention'
import Youtube from '@tiptap/extension-youtube'
import { useEffect, useCallback, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import * as ReactDOM from 'react-dom'
import { supabase } from '../supabaseClient'
import { ALL_TOOLBAR_ITEMS } from '../hooks/useSettings'
import { TRASH_NODE_MARKER } from '../hooks/useNodes'
import { getValidDriveToken } from '../utils/driveToken'

// ── 長押しタップ暴発防止用のグローバルタイマー ──
let g_lastContextMenuTime = 0;

// ── FontSize Extension ──
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{ types: ['textStyle', 'taskItem'], attributes: { fontSize: {
      default: null,
      parseHTML: el => el.style.fontSize || null,
      renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
    }}}]
  },
  addCommands() {
    return {
      setFontSize: size => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})

// ── CustomImage (DriveのIDを保持できるように拡張) ──
const CustomImage = Image.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: true,
      allowBase64: false,
    }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: el => el.getAttribute('width'),
        renderHTML: attrs => attrs.width ? { width: attrs.width } : {},
      },
      style: {
        default: null,
        parseHTML: el => el.getAttribute('style'),
        renderHTML: attrs => attrs.style ? { style: attrs.style } : {},
      },
      // DriveのファイルIDをHTMLに記録する
      driveId: {
        default: null,
        parseHTML: el => el.getAttribute('data-drive-id'),
        renderHTML: attrs => attrs.driveId ? { 'data-drive-id': attrs.driveId } : {},
      }
    }
  },
  renderHTML({ HTMLAttributes }) {
    const style = HTMLAttributes.style || '';
    const injectedStyle = `display: inline-block !important; margin: 0 4px; vertical-align: baseline; cursor: pointer; ${style}`;
    return ['img', { ...HTMLAttributes, style: injectedStyle }]
  }
})

// ── DriveAudio (Google Drive音声プレイヤー) ──
const DriveAudio = Node.create({
  name: 'driveAudio', group: 'block', atom: true,
  addAttributes() {
    return {
      driveId: { default: null, parseHTML: el => el.getAttribute('data-drive-id') },
      filename: { default: '', parseHTML: el => el.getAttribute('data-filename') },
      mimeType: { default: '', parseHTML: el => el.getAttribute('data-mimetype') }
    }
  },
  parseHTML() { return [{ tag: 'div[data-drive-audio]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-drive-audio': '', 'data-drive-id': HTMLAttributes.driveId, 'data-filename': HTMLAttributes.filename, 'data-mimetype': HTMLAttributes.mimeType }]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'drive-audio-node';
      dom.dataset.driveId = node.attrs.driveId;
      dom.dataset.filename = node.attrs.filename;
      dom.dataset.mimetype = node.attrs.mimeType;
      dom.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:12px; margin:8px 0; background:var(--surface,#f7f7f8); border:1px solid var(--border,#e5e5e7); border-radius:8px; user-select:none; width:100%; min-width:260px; max-width:400px; box-sizing:border-box; cursor:default;';
      
      const header = document.createElement('div');
      header.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text); font-weight:600;';
      header.innerHTML = `<span style="font-size:16px; flex-shrink:0;">🎵</span> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${node.attrs.filename}</span>`;
      
      const audioContainer = document.createElement('div');
      audioContainer.addEventListener('mousedown', e => e.stopPropagation());
      audioContainer.addEventListener('click', e => e.stopPropagation());
      audioContainer.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
      
      let isFetched = false;
      let isLoading = false;
      const playBtn = document.createElement('button');
      playBtn.textContent = '▶ 音声を読み込んで再生';
      playBtn.style.cssText = 'padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer; background:var(--accent); color:white; border:none; border-radius:6px; align-self:flex-start; display:flex; align-items:center; gap:6px; transition:opacity 0.2s;';
      playBtn.onmouseover = () => playBtn.style.opacity = '0.8';
      playBtn.onmouseout = () => playBtn.style.opacity = '1';
      
      playBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isFetched || isLoading) return;
        isLoading = true;
        playBtn.innerHTML = '<span style="font-size:14px">⏳</span> 読み込み中...';
        
        dom.dispatchEvent(new CustomEvent('fetch-drive-audio', { 
          bubbles: true, 
          detail: { 
            driveId: node.attrs.driveId, 
            callback: (result) => {
              if (result && result.iframeUrl) {
                isFetched = true;
                playBtn.style.display = 'none';
                
                audioContainer.style.display = 'flex';
                audioContainer.style.flexDirection = 'column';
                audioContainer.style.gap = '8px';

                const iframe = document.createElement('iframe');
                iframe.src = result.iframeUrl;
                iframe.width = '100%';
                iframe.height = '140px'; 
                iframe.style.border = 'none';
                iframe.style.borderRadius = '8px';
                iframe.style.background = '#fff';
                audioContainer.appendChild(iframe);

                if (result.fallbackUrl) {
                  const fallbackBtn = document.createElement('button');
                  fallbackBtn.innerHTML = '↗ 別タブで開く';
                  fallbackBtn.style.cssText = 'padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:6px; align-self: flex-start; display: flex; align-items: center;';
                  fallbackBtn.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    window.open(result.fallbackUrl, '_blank');
                  };
                  fallbackBtn.onmousedown = (ev) => ev.stopPropagation();
                  audioContainer.appendChild(fallbackBtn);
                }
                
              } else if (result && result.blobUrl) {
                isFetched = true;
                playBtn.style.display = 'none';
                const audioEl = document.createElement('audio');
                audioEl.controls = true;
                audioEl.src = result.blobUrl;
                audioEl.style.width = '100%';
                audioContainer.appendChild(audioEl);
                audioEl.play().catch(err => console.log('Autoplay blocked:', err));
              } else {
                playBtn.innerHTML = '❌ 読み込み失敗（再試行）';
                isLoading = false;
                isFetched = false;
              }
            }
          } 
        }));
      });
      
      playBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })

      dom.appendChild(header);
      dom.appendChild(playBtn);
      dom.appendChild(audioContainer);
      
      return { dom };
    }
  }
})

// ── SearchHighlight（本文内検索ハイライト）──
const searchHighlightKey = new PluginKey('searchHighlight')

// ExtensionインスタンスIDごとにqueryを保持するMap
const searchQueryMap = new Map()

const SearchHighlight = Extension.create({
  name: 'searchHighlight',
  addOptions() { return { searchQuery: '' } },
  addProseMirrorPlugins() {
    const instanceId = Math.random().toString(36).slice(2)
    searchQueryMap.set(instanceId, '')
    return [
      new Plugin({
        key: searchHighlightKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc, searchQueryMap.get(instanceId) || '')
          },
          apply(tr, old, __, newState) {
            const meta = tr.getMeta(searchHighlightKey)
            if (meta !== undefined) {
              searchQueryMap.set(instanceId, meta)
              return buildDecorations(newState.doc, meta)
            }
            if (tr.docChanged) {
              return buildDecorations(newState.doc, searchQueryMap.get(instanceId) || '')
            }
            return old
          },
        },
        props: {
          decorations(state) { return this.getState(state) },
        },
        view() {
          return {
            destroy() { searchQueryMap.delete(instanceId) }
          }
        },
      })
    ]
  },
})

function buildDecorations(doc, query) {
  if (!query || query.length < 1) return DecorationSet.empty
  const decorations = []
  const lowerQuery = query.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text || ''
    const lowerText = text.toLowerCase()
    let start = 0
    while (true) {
      const idx = lowerText.indexOf(lowerQuery, start)
      if (idx === -1) break
      decorations.push(
        Decoration.inline(pos + idx, pos + idx + query.length, {
          style: 'background:#fef08a;color:#1a1a1a;border-radius:2px;',
        })
      )
      start = idx + query.length
    }
  })
  return DecorationSet.create(doc, decorations)
}

// ── TableOfContentsBlock（目次ブロック・リアルタイム反映）──
const TableOfContentsBlock = Node.create({
  name: 'tableOfContentsBlock',
  group: 'block',
  atom: true,
  addAttributes() { return {} },
  parseHTML() { return [{ tag: 'div[data-toc-block]' }] },
  renderHTML() { return ['div', { 'data-toc-block': '' }] },
  addNodeView() {
    return ({ getPos, editor }) => {
      // ── DOM構造 ──
      const dom = document.createElement('div')
      dom.setAttribute('data-toc-block', '')
      dom.setAttribute('contenteditable', 'false')
      dom.style.cssText = [
        'margin:8px 0;',
        'background:rgba(80,80,220,0.06);',
        'border:1.5px solid rgba(80,80,220,0.22);',
        'border-radius:10px;',
        'overflow:hidden;',
        'user-select:none;',
      ].join('')

      // ヘッダー行
      const header = document.createElement('div')
      header.style.cssText = [
        'display:flex;align-items:center;gap:8px;',
        'padding:8px 12px;',
        'background:rgba(80,80,220,0.1);',
        'border-bottom:1px solid rgba(80,80,220,0.18);',
      ].join('')

      const headerIcon = document.createElement('span')
      headerIcon.textContent = '≡'
      headerIcon.style.cssText = 'font-size:16px;font-weight:700;color:rgba(60,60,180,0.8);'

      const headerLabel = document.createElement('span')
      headerLabel.textContent = '目次'
      headerLabel.style.cssText = 'font-size:12px;font-weight:700;color:var(--text,#1a1a1a);flex:1;'

      const deleteBtn = document.createElement('button')
      deleteBtn.textContent = '✕'
      deleteBtn.title = 'ブロックを削除'
      deleteBtn.style.cssText = [
        'width:20px;height:20px;',
        'display:flex;align-items:center;justify-content:center;',
        'background:var(--surface,#f7f7f8);',
        'border:1px solid var(--border,#e5e5e7);',
        'border-radius:4px;cursor:pointer;',
        'font-size:10px;color:var(--text-muted,#888);padding:0;flex-shrink:0;',
      ].join('')
      deleteBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation() })
      deleteBtn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation()
        if (!editor.isEditable) return
        if (typeof getPos === 'function') {
          const pos = getPos()
          editor.view.dispatch(editor.state.tr.delete(pos, pos + 1))
        }
      })

      header.appendChild(headerIcon)
      header.appendChild(headerLabel)
      header.appendChild(deleteBtn)

      // 目次リスト領域
      const list = document.createElement('div')
      list.style.cssText = 'padding:6px 0;'

      dom.appendChild(header)
      dom.appendChild(list)

      // ── 目次を更新する関数 ──
      const levelIndent = { 1: 0, 2: 14, 3: 26, 4: 38 }
      const levelSize   = { 1: 14, 2: 13, 3: 12, 4: 11 }
      const levelWeight = { 1: 700, 2: 600, 3: 400, 4: 400 }

      const rebuild = (doc) => {
        // このブロック自身の位置を除外して見出しを収集
        const selfPos = typeof getPos === 'function' ? getPos() : -1
        const items = []
        doc.descendants((node, pos) => {
          if (pos === selfPos) return false // 自分自身はスキップ
          if (node.type.name === 'heading') {
            const text = node.textContent.trim()
            if (text) items.push({ level: node.attrs.level || 1, text, pos })
          }
        })

        // 差分があれば再描画（ちらつき防止）
        const newHtml = items.map(h => {
          const indent = levelIndent[h.level] || 0
          const size   = levelSize[h.level]   || 12
          const weight = levelWeight[h.level] || 400
          return [
            `<div data-toc-pos="${h.pos}" style="`,
            `display:flex;align-items:baseline;gap:6px;`,
            `padding:5px 14px 5px ${14 + indent}px;`,
            `cursor:pointer;border-bottom:1px solid rgba(80,80,220,0.08);`,
            `transition:background 0.1s;`,
            `">`,
            `<span style="font-size:10px;font-weight:800;color:rgba(60,60,180,0.55);min-width:18px;flex-shrink:0;">H${h.level}</span>`,
            `<span style="font-size:${size}px;font-weight:${weight};color:var(--text,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">`,
            h.text.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
            `</span>`,
            `</div>`,
          ].join('')
        }).join('')

        const emptyHtml = [
          `<div style="padding:12px 14px;font-size:12px;color:var(--text-muted,#888);text-align:center;">`,
          `見出し（H1〜H4）がありません`,
          `</div>`,
        ].join('')

        list.innerHTML = items.length > 0 ? newHtml : emptyHtml

        // クリックイベントを付与
        list.querySelectorAll('[data-toc-pos]').forEach(el => {
          el.addEventListener('mouseenter', () => { el.style.background = 'rgba(80,80,220,0.08)' })
          el.addEventListener('mouseleave', () => { el.style.background = '' })
          el.addEventListener('click', () => {
            const pos = parseInt(el.getAttribute('data-toc-pos'), 10)
            if (isNaN(pos)) return
            try {
              const domAtPos = editor.view.domAtPos(pos + 1)
              const target = domAtPos?.node?.nodeType === 1
                ? domAtPos.node
                : domAtPos?.node?.parentElement
              if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            } catch {}
          })
        })
      }

      // 初回描画
      rebuild(editor.state.doc)

      // editorのupdate時にリビルド
      const onUpdate = () => rebuild(editor.state.doc)
      editor.on('update', onUpdate)

      return {
        dom,
        draggable: true,
        destroy() {
          editor.off('update', onUpdate)
        },
      }
    }
  },
})

// ── ChildrenSummaryBlock（子孫まとめブロック）──
const ChildrenSummaryBlock = Node.create({
  name: 'childrenSummaryBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      label: { default: '子孫まとめを開く', parseHTML: el => el.getAttribute('data-label') || '子孫まとめを開く' },
    }
  },
  parseHTML() { return [{ tag: 'div[data-children-summary-block]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-children-summary-block': '', 'data-label': HTMLAttributes.label }]
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div')
      dom.setAttribute('data-children-summary-block', '')
      dom.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;margin:6px 0;background:rgba(20,160,100,0.09);border:1.5px solid rgba(20,160,100,0.28);border-radius:10px;user-select:none;'

      const icon = document.createElement('span')
      icon.textContent = '📋'
      icon.style.cssText = 'font-size:18px;flex-shrink:0;'

      // ── ラベル表示（通常時）──
      const textEl = document.createElement('span')
      textEl.textContent = node.attrs.label || '子孫まとめを開く'
      textEl.style.cssText = 'font-size:13px;font-weight:600;color:var(--text,#1a1a1a);flex:1;cursor:pointer;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
      textEl.title = 'ダブルクリックでラベルを編集'

      // ── ラベル編集input（編集時）──
      const inputEl = document.createElement('input')
      inputEl.type = 'text'
      inputEl.style.cssText = [
        'display:none;flex:1;min-width:0;',
        'font-size:13px;font-weight:600;',
        'color:var(--text,#1a1a1a);',
        'background:var(--bg,#fff);',
        'border:1.5px solid rgba(20,160,100,0.5);',
        'border-radius:5px;',
        'padding:2px 6px;outline:none;',
      ].join('')

      let editingLabel = false

      const startEdit = (e) => {
        e.stopPropagation()
        if (!editor.isEditable || editingLabel) return
        editingLabel = true
        inputEl.value = textEl.textContent
        textEl.style.display = 'none'
        inputEl.style.display = 'flex'
        dom.style.cursor = 'default'
        // editorのフォーカスを外してからinputにフォーカスを渡す
        editor.commands.blur()
        setTimeout(() => { inputEl.focus(); inputEl.select() }, 0)
      }

      const commitEdit = () => {
        if (!editingLabel) return
        editingLabel = false
        const newLabel = inputEl.value.trim() || '子孫まとめを開く'
        textEl.textContent = newLabel
        inputEl.style.display = 'none'
        textEl.style.display = ''
        dom.style.cursor = ''
        // TipTapのattrを更新して保存
        if (typeof getPos === 'function') {
          const pos = getPos()
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, { label: newLabel })
          )
        }
      }

      const cancelEdit = () => {
        if (!editingLabel) return
        editingLabel = false
        inputEl.style.display = 'none'
        textEl.style.display = ''
        dom.style.cursor = ''
      }

      inputEl.addEventListener('mousedown', e => { e.stopPropagation() })
      inputEl.addEventListener('click', e => e.stopPropagation())
      inputEl.addEventListener('keypress', e => e.stopPropagation())
      inputEl.addEventListener('keyup', e => e.stopPropagation())
      inputEl.addEventListener('paste', e => e.stopPropagation())
      inputEl.addEventListener('input', e => e.stopPropagation())
      // IME（日本語入力）のcompositionイベントもTipTapに渡さない
      inputEl.addEventListener('compositionstart', e => e.stopPropagation())
      inputEl.addEventListener('compositionupdate', e => e.stopPropagation())
      inputEl.addEventListener('compositionend', e => e.stopPropagation())
      inputEl.addEventListener('keydown', e => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          // IME変換中のEnter（漢字確定）は無視、変換確定後のEnterのみ保存
          if (!e.isComposing && e.keyCode !== 229) commitEdit()
        }
        if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
      })
      inputEl.addEventListener('blur', commitEdit)

      // ヒント
      const hint = document.createElement('span')
      hint.textContent = 'タップで展開 →'
      hint.style.cssText = 'font-size:11px;color:rgba(20,160,100,0.7);flex-shrink:0;'

      // 削除ボタン
      const deleteBtn = document.createElement('button')
      deleteBtn.textContent = '✕'
      deleteBtn.setAttribute('contenteditable', 'false')
      deleteBtn.title = 'ブロックを削除'
      deleteBtn.style.cssText = 'width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:var(--surface,#f7f7f8);border:1px solid var(--border,#e5e5e7);border-radius:4px;cursor:pointer;font-size:11px;color:var(--text-muted,#888);padding:0;flex-shrink:0;'
      deleteBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation() })
      deleteBtn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation()
        if (!editor.isEditable) return
        if (typeof getPos === 'function') {
          const pos = getPos()
          editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize))
        }
      })

      dom.appendChild(icon)
      dom.appendChild(textEl)
      dom.appendChild(inputEl)
      dom.appendChild(hint)
      dom.appendChild(deleteBtn)

      // クリック：シングルで展開、ダブルクリックでラベル編集
      let clickTimer = null
      let touchMoved = false
      dom.addEventListener('touchstart', () => { touchMoved = false }, { passive: true })
      dom.addEventListener('touchmove', () => { touchMoved = true }, { passive: true })
      dom.addEventListener('click', e => {
        if (touchMoved) return
        if (e.target === deleteBtn || e.target === inputEl) return
        if (editingLabel) return
        // ダブルクリック判定：250ms以内に2回クリックで編集
        if (clickTimer) {
          clearTimeout(clickTimer)
          clickTimer = null
          startEdit(e)
        } else {
          clickTimer = setTimeout(() => {
            clickTimer = null
            dom.dispatchEvent(new CustomEvent('open-children-summary', { bubbles: true }))
          }, 250)
        }
      })

      // attrが外から更新された時にテキストを同期
      const update = (updatedNode) => {
        if (!editingLabel) {
          textEl.textContent = updatedNode.attrs.label || '子孫まとめを開く'
        }
        return true
      }

      return {
        dom,
        draggable: true,
        update,
        destroy() {
          if (clickTimer) clearTimeout(clickTimer)
        },
      }
    }
  },
})

// ── Details（折りたたみ）──
const DetailsSummary = Node.create({
  name: 'detailsSummary', group: 'block', content: 'inline*', defining: true,
  parseHTML() { return [{ tag: 'summary' }] },
  renderHTML({ HTMLAttributes }) { 
    return ['summary', { ...HTMLAttributes, style: 'display: block !important; cursor: pointer; padding-right: 32px;' }, 0] 
  },
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state, view } = editor
        const { selection } = state
        const { $anchor, empty } = selection
        if (!empty) return false 

        if ($anchor.parent.type.name === 'detailsSummary' && $anchor.parentOffset === 0) {
          for (let i = $anchor.depth; i > 0; i--) {
            if ($anchor.node(i).type.name === 'details') {
              const pos = $anchor.before(i)
              const nodeSize = $anchor.node(i).nodeSize
              view.dispatch(state.tr.delete(pos, pos + nodeSize))
              return true
            }
          }
        }
        return false
      },
      Enter: ({ editor }) => {
        const { state, view } = editor
        const { selection } = state
        const { $anchor, empty } = selection
        if (!empty || $anchor.parent.type.name !== 'detailsSummary') return false
        
        const end = $anchor.end($anchor.depth)
        const tr = state.tr
        const para = state.schema.nodes.paragraph.create()
        tr.insert(end + 1, para)
        tr.setSelection(state.selection.constructor.near(tr.doc.resolve(end + 2)))
        view.dispatch(tr)
        return true
      },
    }
  },
})

const Details = Node.create({
  name: 'details', group: 'block', content: 'detailsSummary block+', defining: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: el => el.hasAttribute('open'),
        renderHTML: attrs => attrs.open ? { open: '' } : {},
      },
    }
  },
  parseHTML() { return [{ tag: 'details' }] },
  renderHTML({ HTMLAttributes }) { return ['details', HTMLAttributes, 0] },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const container = document.createElement('div')
      container.style.position = 'relative'

      const dom = document.createElement('details')
      if (node.attrs.open) dom.setAttribute('open', '')

      // ── 折りたたみ解除（解放）ボタン ──
      const deleteBtn = document.createElement('button')
      deleteBtn.innerHTML = '✕'
      deleteBtn.setAttribute('contenteditable', 'false')
      deleteBtn.title = '折りたたみ解除'
      deleteBtn.style.cssText = 'position:absolute; top:2px; right:0px; width:24px; height:24px; display:flex; align-items:center; justify-content:center; background:var(--surface,#f7f7f8); border:1px solid var(--border,#e5e5e7); border-radius:4px; cursor:pointer; font-size:12px; color:var(--text-muted,#888); z-index:10; opacity:0.6; transition:opacity 0.2s; padding:0;'
      deleteBtn.onmouseover = () => deleteBtn.style.opacity = '1'
      deleteBtn.onmouseout = () => deleteBtn.style.opacity = '0.6'
      
      deleteBtn.addEventListener('mousedown', (e) => { e.preventDefault() })
      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!editor.isEditable) return
        if (typeof getPos === 'function') {
          const pos = getPos()
          const newNodes = []
          node.content.forEach((child) => {
            if (child.type.name === 'detailsSummary') {
              newNodes.push(editor.schema.nodes.paragraph.create(null, child.content))
            } else {
              newNodes.push(child)
            }
          })
          editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, newNodes))
        }
      })
      deleteBtn.addEventListener('touchstart', (e) => { e.stopPropagation() }, { passive: true })

      container.appendChild(dom)
      container.appendChild(deleteBtn)

      const contentDOM = dom

      const onToggle = (e) => e.preventDefault()
      dom.addEventListener('toggle', onToggle)

      const onClick = (e) => {
        const summary = e.target.closest('summary')
        if (summary && dom.contains(summary)) {
          e.preventDefault() 
          if (typeof getPos !== 'function') return
          const nextOpen = !node.attrs.open
          editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, open: nextOpen }))
        }
      }
      dom.addEventListener('click', onClick)

      return {
        dom: container,
        contentDOM,
        ignoreMutation(mutation) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'open') return true
          return false
        },
        update(updated) {
          if (updated.type.name !== 'details') return false
          node = updated
          const isOpen = !!updated.attrs.open
          if (isOpen !== dom.hasAttribute('open')) {
            if (isOpen) dom.setAttribute('open', '')
            else dom.removeAttribute('open')
          }
          return true
        },
        destroy() {
          dom.removeEventListener('toggle', onToggle)
          dom.removeEventListener('click', onClick)
        }
      }
    }
  },
})

// ── FileAttachment ──
const FileAttachment = Node.create({
  name: 'fileAttachment', group: 'inline', inline: true, atom: true,
  addAttributes() {
    return {
      filename: { default: '', parseHTML: el => el.getAttribute('data-fa-filename') || '' },
      content: { default: '', parseHTML: el => {
        const b64 = el.getAttribute('data-fa-content') || ''
        try { return decodeURIComponent(atob(b64)) } catch { return b64 }
      }}
    }
  },
  parseHTML() { return [{ tag: 'span[data-file-attachment]' }] },
  renderHTML({ HTMLAttributes }) {
    const b64 = btoa(encodeURIComponent(HTMLAttributes.content || ''))
    return ['span', { 'data-file-attachment': '', 'data-fa-filename': HTMLAttributes.filename || '', 'data-fa-content': b64 }]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'file-attachment-node'
      
      const updateView = (n) => {
        dom.dataset.filename = n.attrs.filename
        dom.dataset.content = n.attrs.content
        dom.style.cssText = `display:inline-flex !important;align-items:center;gap:8px;padding:6px 12px;margin:4px;background:var(--surface,#f7f7f8);border:1px solid var(--border,#e5e5e7);border-radius:8px;cursor:grab;font-size:13px;color:var(--text,#1a1a1a);max-width:280px;user-select:none;-webkit-user-select:none;vertical-align:baseline;`
        dom.contentEditable = 'false'
        dom.innerHTML = `<span style="font-size:18px;flex-shrink:0">📄</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.attrs.filename}</span><span style="font-size:10px;color:#888;flex-shrink:0">▶</span>`
      }
      updateView(node)
      
      let touchMoved = false
      dom.addEventListener('touchstart', () => { touchMoved = false }, { passive: true })
      dom.addEventListener('touchmove', () => { touchMoved = true }, { passive: true })
      
      dom.addEventListener('click', (e) => {
        if (touchMoved) return
        if (Date.now() - g_lastContextMenuTime < 500) return
        dom.dispatchEvent(new CustomEvent('file-attachment-open', { bubbles: true, detail: { filename: node.attrs.filename, content: node.attrs.content } }))
      })
      
      return { 
        dom,
        draggable: true,  // ← これがないと選択状態にならないとドラッグ不可
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'fileAttachment') return false
          node = updatedNode
          updateView(node)
          return true
        }
      }
    }
  },
})

// ── DrivePdf (Google Drive PDFリンク) ──
// FileAttachmentと同じ inline/atom 構造で統一
const DrivePdf = Node.create({
  name: 'drivePdf', group: 'inline', inline: true, atom: true,
  addAttributes() {
    return {
      driveId:  { default: null, parseHTML: el => el.getAttribute('data-drive-id') || null },
      filename: { default: '', parseHTML: el => el.getAttribute('data-filename') || '' },
    }
  },
  parseHTML() { return [{ tag: 'span[data-drive-pdf]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-drive-pdf': '', 'data-drive-id': HTMLAttributes.driveId || '', 'data-filename': HTMLAttributes.filename || '' }]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')  // ← inlineなのでspan
      dom.className = 'drive-pdf-node'
      dom.dataset.driveId = node.attrs.driveId || ''
      dom.dataset.filename = node.attrs.filename || ''
      dom.style.cssText = 'display:inline-flex !important;align-items:center;gap:8px;padding:6px 12px;margin:4px;background:var(--surface,#f7f7f8);border:1px solid var(--border,#e5e5e7);border-radius:8px;cursor:grab;font-size:13px;color:var(--text,#1a1a1a);max-width:280px;user-select:none;-webkit-user-select:none;vertical-align:middle;'
      dom.contentEditable = 'false'
      dom.innerHTML = `<span style="font-size:18px;flex-shrink:0">📑</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${node.attrs.filename || 'PDF'}</span><span style="font-size:10px;color:#888;flex-shrink:0">↗</span>`
      let touchMoved = false
      dom.addEventListener('touchstart', () => { touchMoved = false }, { passive: true })
      dom.addEventListener('touchmove', () => { touchMoved = true }, { passive: true })
      dom.addEventListener('click', (e) => {
        if (touchMoved) return
        if (Date.now() - g_lastContextMenuTime < 500) return
        if (node.attrs.driveId) window.open(`https://drive.google.com/file/d/${node.attrs.driveId}/view`, '_blank')
      })
      return { dom, draggable: true }
    }
  },
})


const COLORS = ['#1a1a1a','#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c','#ffffff','#fc8181','#f6ad55','#faf089','#9ae6b4','#90cdf4','#d6bcfa','#fbb6ce','#718096','#c53030','#c05621','#b7791f','#276749','#2b6cb0','#6b46c1','#97266d']
const HIGHLIGHTS = ['#fefcbf','#fed7d7','#c6f6d5','#bee3f8','#e9d8fd','#fbb6ce','#e2e8f0','#f6e05e','#fc8181','#68d391','#63b3ed','#b794f4','#f687b3','#cbd5e0']
const FONT_SIZES = [10,11,12,13,14,15,16,18,20,24,28,32,36,48]
const TEXT_EXTS = new Set(['txt','md','csv','json','xml','yaml','yml','js','jsx','ts','tsx','css','scss','less','html','htm','py','rb','php','java','c','cpp','h','cs','go','rs','swift','sh','bash','zsh','bat','cmd','ps1','ini','conf','cfg','toml','env','log','mjs','cjs','vue','svelte'])
const isTextFile = f => TEXT_EXTS.has((f.name.split('.').pop()||'').toLowerCase()) || f.type.startsWith('text/')

function getCurrentFontSize(editor) {
  const attrs = editor.getAttributes('textStyle')
  return attrs.fontSize ? parseInt(attrs.fontSize) : null
}

function withScrollLock(el, fn) {
  if (!el) { fn(); return }
  const top = el.scrollTop
  fn()
  requestAnimationFrame(() => { el.scrollTop = top; requestAnimationFrame(() => { el.scrollTop = top }) })
}

function compressImage(src, quality = 0.7, maxWidth = 1280) {
  return new Promise(resolve => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality) })
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Google Drive へファイルをアップロードする関数
async function uploadToGoogleDrive(file, token) {
  const FOLDER_NAME = 'NaMaMeMo';
  
  let folderId = null;
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const searchData = await searchRes.json();
  if (searchData.error) throw new Error(searchData.error.message);
  
  if (searchData.files && searchData.files.length > 0) {
    folderId = searchData.files[0].id;
  } else {
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    const createData = await createRes.json();
    if (createData.error) throw new Error(createData.error.message);
    folderId = createData.id;
  }

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type },
    body: file
  });
  const uploadData = await uploadRes.json();
  if (uploadData.error) throw new Error(uploadData.error.message);
  
  const fileId = uploadData.id;

  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${folderId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: file.name
    })
  });

  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' })
  });

  return fileId;
}


// ── プログレス付きGoogleDriveアップロード（動画用）──
async function uploadToGoogleDriveWithProgress(file, token, onProgress) {
  const FOLDER_NAME = 'NaMaMeMo'
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const searchData = await searchRes.json()
  if (searchData.error) throw new Error(searchData.error.message)
  let folderId = searchData.files?.[0]?.id
  if (!folderId) {
    const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    })
    const cd = await cr.json()
    if (cd.error) throw new Error(cd.error.message)
    folderId = cd.id
  }
  const initRes = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': file.type,
        'X-Upload-Content-Length': String(file.size),
      },
      body: JSON.stringify({ name: file.name, parents: [folderId] })
    }
  )
  if (!initRes.ok) throw new Error('Resumable upload初期化失敗: ' + initRes.status)
  const uploadUrl = initRes.headers.get('Location')
  if (!uploadUrl) throw new Error('Upload URLが取得できませんでした')
  const fileId = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).id) }
        catch { reject(new Error('レスポンス解析失敗')) }
      } else { reject(new Error('アップロード失敗: ' + xhr.status)) }
    }
    xhr.onerror = () => reject(new Error('ネットワークエラー'))
    xhr.send(file)
  })
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' })
  })
  return fileId
}

// ── 動画サムネイル抽出 ──
function extractVideoThumbnail(file, timeSeconds = 1) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'; video.muted = true; video.playsInline = true
    const url = URL.createObjectURL(file)
    video.src = url
    video.onloadeddata = () => { video.currentTime = timeSeconds }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      const ratio = Math.min(1, 320 / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * ratio)
      canvas.height = Math.round(video.videoHeight * ratio)
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('動画読み込み失敗')) }
  })
}

// ── DriveVideo Node ──
const DriveVideo = Node.create({
  name: 'driveVideo', group: 'block', atom: true,
  addAttributes() {
    return {
      driveId:  { default: null, parseHTML: el => el.getAttribute('data-drive-id') },
      filename: { default: '', parseHTML: el => el.getAttribute('data-filename') },
      thumbSrc: { default: null, parseHTML: el => el.getAttribute('data-thumb-src') },
      mimeType: { default: '', parseHTML: el => el.getAttribute('data-mimetype') },
    }
  },
  parseHTML() { return [{ tag: 'div[data-drive-video]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-drive-video': '', 'data-drive-id': HTMLAttributes.driveId, 'data-filename': HTMLAttributes.filename, 'data-thumb-src': HTMLAttributes.thumbSrc, 'data-mimetype': HTMLAttributes.mimeType }]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'drive-video-node'
      dom.dataset.driveId = node.attrs.driveId
      dom.dataset.filename = node.attrs.filename
      dom.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;margin:8px 0;background:var(--surface,#f7f7f8);border:1px solid var(--border,#e5e5e7);border-radius:10px;user-select:none;width:100%;max-width:480px;box-sizing:border-box;'
      const header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);font-weight:600;'
      header.innerHTML = `<span style="font-size:18px;flex-shrink:0;">🎬</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${node.attrs.filename}</span>`
      const playerArea = document.createElement('div')
      playerArea.style.cssText = 'position:relative;width:100%;'
      playerArea.addEventListener('mousedown', e => e.stopPropagation())
      playerArea.addEventListener('click', e => e.stopPropagation())
      playerArea.addEventListener('touchstart', e => e.stopPropagation(), { passive: true })
      let isPlaying = false
      const thumb = document.createElement('div')
      thumb.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;background:#1a1a1a;border-radius:8px;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;'
      if (node.attrs.thumbSrc) {
        const img = document.createElement('img')
        img.src = node.attrs.thumbSrc
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;'
        thumb.appendChild(img)
      }
      const playOverlay = document.createElement('div')
      playOverlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);border-radius:8px;'
      playOverlay.innerHTML = '<div style="width:52px;height:52px;background:rgba(255,255,255,0.92);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;padding-left:4px;box-shadow:0 2px 12px rgba(0,0,0,0.3);">▶</div>'
      thumb.appendChild(playOverlay)
      thumb.onclick = (e) => {
        e.preventDefault(); e.stopPropagation()
        if (isPlaying) return; isPlaying = true
        const iframe = document.createElement('iframe')
        iframe.src = `https://drive.google.com/file/d/${node.attrs.driveId}/preview`
        iframe.style.cssText = 'width:100%;aspect-ratio:16/9;border:none;border-radius:8px;background:#000;'
        iframe.allow = 'autoplay'
        thumb.style.display = 'none'; playerArea.appendChild(iframe)
        const openBtn = document.createElement('button')
        openBtn.innerHTML = '↗ Google Driveで開く'
        openBtn.style.cssText = 'margin-top:6px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px;'
        openBtn.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); window.open(`https://drive.google.com/file/d/${node.attrs.driveId}/view`, '_blank') }
        openBtn.onmousedown = ev => ev.stopPropagation()
        playerArea.appendChild(openBtn)
      }
      playerArea.appendChild(thumb)
      dom.appendChild(header); dom.appendChild(playerArea)
      return { dom, draggable: true }
    }
  },
})

// ── FontFamily Extension ──
const FontFamily = Extension.create({
  name: 'fontFamily',
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: { fontFamily: {
      default: null,
      parseHTML: el => el.style.fontFamily?.replace(/['"]/g, '') || null,
      renderHTML: attrs => attrs.fontFamily ? { style: `font-family: '${attrs.fontFamily}', sans-serif` } : {},
    }}}]
  },
  addCommands() {
    return {
      setFontFamily: family => ({ chain }) => chain().setMark('textStyle', { fontFamily: family }).run(),
      unsetFontFamily: () => ({ chain }) => chain().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run(),
    }
  },
})

const FONT_FAMILIES = [
  { label: 'デフォルト',          value: null },
  { label: 'Noto Sans JP',        value: 'Noto Sans JP' },
  { label: 'Noto Serif JP',       value: 'Noto Serif JP' },
  { label: 'M PLUS Rounded 1c',   value: 'M PLUS Rounded 1c' },
  { label: 'Zen Kaku Gothic New', value: 'Zen Kaku Gothic New' },
  { label: 'Zen Maru Gothic',     value: 'Zen Maru Gothic' },
  { label: 'BIZ UDPGothic',       value: 'BIZ UDPGothic' },
  { label: 'Shippori Mincho',     value: 'Shippori Mincho' },
  { label: 'Klee One',            value: 'Klee One' },
  { label: 'Yomogi',              value: 'Yomogi' },
  { label: 'Mochiy Pop One',      value: 'Mochiy Pop One' },
  { label: 'Monospace',           value: 'ui-monospace' },
]

// ─────────────────────────────────────────────────
// RichEditor 本体
// ─────────────────────────────────────────────────
export default forwardRef(function RichEditor(
  { node, onUpdateContent, onTogglePublic, onCopyPublicUrl, userId, toolbarCollapsed, onTextFileDrop, settings, readOnly, onOpenReminder, onNavigateAttachment, allNodes, onImportFile, searchQuery = '' }, ref
) {
  const defaultFontSize = settings?.defaultFontSize || 15
  const lineHeight = settings?.lineHeight || 1.6
  const isTrash = node?.content?.includes(TRASH_NODE_MARKER) ?? false
  const isReadOnly = isTrash || readOnly 

  const enabledItems = (() => {
    const raw = settings?.enabledToolbarItems
    if (!raw || !Array.isArray(raw) || raw.length === 0) return ALL_TOOLBAR_ITEMS.map(i => i.id)
    return raw.map(i => (typeof i === 'string' ? i : i?.id)).filter(Boolean)
  })()

  const saveTimer = useRef(null)
  const [saving, setSaving] = useState(false)
  const [uploadingText, setUploadingText] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [fileViewer, setFileViewer] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [compressDialog, setCompressDialog] = useState(null)
  const [moveMode, setMoveMode] = useState(null)
  const moveModeRef = useRef(null)
  const [, forceUpdate] = useState(0)
  const wrapperRef = useRef(null)
  const editorAreaRef = useRef(null)
  const contextMenuRef = useRef(null)
  const [undoDepth, setUndoDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
  const isSyncingRef = useRef(false)
  const prevNodeIdRef = useRef(null)

  const [editingFontSize, setEditingFontSize] = useState(false)
  const [fontSizeInput, setFontSizeInput] = useState('')
  const fontSizeInputRef = useRef(null)
  const savedSelectionRef = useRef(null)
  const [openPopover, setOpenPopover] = useState(null)   // 'color'|'highlight'|'align'|'font'|'share'|null
  const [nodeTransferModal, setNodeTransferModal] = useState(null) // { type, src, filename, content, driveId }
  const [homeShortcutModal, setHomeShortcutModal] = useState(false)
  const [exportModal, setExportModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const linkInputRef = useRef(null)
  const allNodesRef = useRef(allNodes)
  const [mentionState, setMentionState] = useState(null)
  const mentionKeyHandlerRef = useRef(null)
  const [childrenSummaryOpen, setChildrenSummaryOpen] = useState(false)

  useEffect(() => { moveModeRef.current = moveMode }, [moveMode])
  useEffect(() => { allNodesRef.current = allNodes }, [allNodes])

  const updateHistoryState = useCallback((ed) => {
    if (!ed) return
    try {
      const hist = ed.state['history$']
      if (hist) { setUndoDepth(hist.done?.eventCount || 0); setRedoDepth(hist.undone?.eventCount || 0) }
    } catch {}
  }, [])

  const mentionExtension = Mention.configure({
    HTMLAttributes: { class: 'mention' },
    renderLabel({ options, node }) {
      return `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`
    },
    suggestion: {
      char: '@',
      items: ({ query }) =>
        (allNodesRef.current || [])
          .filter(n => n.title && n.title.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map(n => ({ id: n.id, label: n.title })),
      render: () => ({
        onStart: (props) => { setMentionState({ items: props.items, command: props.command, clientRect: props.clientRect }) },
        onUpdate: (props) => { setMentionState({ items: props.items, command: props.command, clientRect: props.clientRect }) },
        onKeyDown: ({ event }) => mentionKeyHandlerRef.current?.(event) ?? false,
        onExit: () => setMentionState(null),
      }),
    },
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: false }),
      TextStyle, FontSize, FontFamily, Color, Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      CustomImage.configure({ inline: true, allowBase64: false }),
      TaskList, TaskItem.configure({ nested: true }),
      DetailsSummary, Details, ChildrenSummaryBlock, TableOfContentsBlock,
      SearchHighlight.configure({ searchQuery: '' }),
      FileAttachment, DriveAudio, DriveVideo, DrivePdf,
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
      Table.configure({ resizable: false }),
      TableRow, TableCell, TableHeader,
      CharacterCount,
      mentionExtension,
      Youtube.configure({ width: '100%', nocookie: true }),
    ],
    content: node?.content || '',
    editable: !isReadOnly,
    onUpdate: ({ editor }) => {
      if (isSyncingRef.current || isReadOnly) return
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
      // ★ クリップボードのテキスト出力：<p>を改行1つに変換
      // デフォルトだと貼り付け先で改行が2重になる問題を防ぐ
      clipboardTextSerializer(content) {
        // TextSerializerを使ってブロックを改行1つで区切る
        const lines = []
        content.content.forEach(node => {
          if (node.type.name === 'paragraph') {
            lines.push(node.textContent)
          } else if (node.type.name === 'hardBreak') {
            lines.push('')
          } else {
            const text = node.textContent
            if (text) lines.push(text)
          }
        })
        return lines.join('\n')
      },
      handlePaste(view, event) {
        if (isReadOnly) return false
        const items = event.clipboardData?.items; if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault(); const f = item.getAsFile(); if (f) handleFile(f); return true
          }
          if (item.type.startsWith('audio/')) {
            event.preventDefault(); const f = item.getAsFile(); if (f) handleFile(f); return true
          }
        }
        return false
      },
    },
  })

  useEffect(() => { if (editor) editor.setEditable(!isReadOnly) }, [editor, isReadOnly])

  // searchQueryが変わったらSearchHighlightプラグインにmetaで通知
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta(searchHighlightKey, searchQuery))
  }, [editor, searchQuery])

  // ★ プレビューや音声再生用のグローバルイベント処理
  useEffect(() => {
    const el = wrapperRef.current; if (!el) return
    const h = e => setFileViewer(e.detail)
    
    // ★ 音声フェッチの処理（APIを叩く前にトークン生存確認を追加）
    const handleAudioFetch = async (e) => {
      const { driveId, callback } = e.detail;
      const token = await getValidDriveToken(settings); // ★ 追加
      
      if (token) {
        try {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            callback({ blobUrl });
          } else {
            callback(null);
          }
        } catch {
          callback(null);
        }
      } else if (isReadOnly) {
        // 公開ページ：iFrame フォールバック
        callback({
          iframeUrl: `https://drive.google.com/file/d/${driveId}/preview`,
          fallbackUrl: `https://drive.google.com/file/d/${driveId}/view`
        });
      } else {
        // Drive 設定済みだが token 未取得 → 再接続を待って再試行
        const retryToken = await getValidDriveToken(settings)
        if (!retryToken) { callback(null); return; }
        try {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
            headers: { Authorization: `Bearer ${retryToken}` }
          });
          if (res.ok) {
            callback({ blobUrl: URL.createObjectURL(await res.blob()) });
          } else {
            callback(null);
          }
        } catch { callback(null); }
      }
    }
    
    el.addEventListener('file-attachment-open', h)
    el.addEventListener('fetch-drive-audio', handleAudioFetch)
    el.addEventListener('open-children-summary', () => setChildrenSummaryOpen(true))
    return () => {
      el.removeEventListener('file-attachment-open', h)
      el.removeEventListener('fetch-drive-audio', handleAudioFetch)
      el.removeEventListener('open-children-summary', () => setChildrenSummaryOpen(true))
    }
  }, [settings, isReadOnly])

  useEffect(() => {
    if (!editor || !node) return
    const isSwitch = prevNodeIdRef.current !== node.id
    prevNodeIdRef.current = node.id
if (!isSwitch && editor.isFocused) {
      return
    }
    const incoming = node.content || ''
    if (editor.getHTML() === incoming) return
    const scrollEl = editorAreaRef.current
    const savedTop = scrollEl?.scrollTop ?? 0
    const focused = editor.isFocused
    const { from, to } = editor.state.selection
    isSyncingRef.current = true
    editor.commands.setContent(incoming, false, { preserveWhitespace: 'full' })
    isSyncingRef.current = false
    if (!isSwitch && focused) {
      requestAnimationFrame(() => {
        try {
          const size = editor.state.doc.content.size
          editor.commands.setTextSelection({ from: Math.min(from, size - 1), to: Math.min(to, size - 1) })
        } catch {}
        if (scrollEl) scrollEl.scrollTop = savedTop
      })
    } else {
      requestAnimationFrame(() => { if (scrollEl) scrollEl.scrollTop = savedTop })
    }
  }, [node?.id, node?.content])

  const setTextAlignSmart = useCallback((alignment) => () => {
    if (!editor || isReadOnly) return;
    withScrollLock(editorAreaRef.current, () => {
      const { selection } = editor.state;
      const blocks = [];

      // 選択範囲内の全ブロックを収集
      editor.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (node.type.name === 'paragraph' || node.type.name === 'heading') {
          blocks.push({ node, pos });
        }
      });

      if (blocks.length > 0) {
        // 複数ブロックをまとめて1トランザクションで更新
        let tr = editor.state.tr;
        blocks.forEach(({ node, pos }) => {
          tr = tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            textAlign: alignment,
          });
        });
        editor.view.dispatch(tr);
        editor.commands.focus();
      } else {
        editor.chain().focus().setTextAlign(alignment).run();
      }
    });
  }, [editor, isReadOnly]);

  const doExecMove = useCallback(() => {
    const mm = moveModeRef.current; if (!mm || !editor) return
    let nodeToMove = null
    
    editor.state.doc.descendants((n, pos) => {
      if (nodeToMove) return false
      const match = mm.type === 'image'  ? n.type.name==='image'&&n.attrs.src===mm.src
                  : mm.type === 'audio'  ? n.type.name==='driveAudio'&&n.attrs.driveId===mm.driveId
                  : mm.type === 'video'  ? n.type.name==='driveVideo'&&n.attrs.driveId===mm.driveId
                  : mm.type === 'pdf'    ? n.type.name==='drivePdf'&&n.attrs.driveId===mm.driveId
                  : n.type.name==='fileAttachment'&&n.attrs.filename===mm.filename
      if (match) {
        nodeToMove = n.toJSON()
        editor.chain().command(({ tr }) => { tr.delete(pos, pos + n.nodeSize); return true }).run()
      }
    })
    
    if (nodeToMove) {
      editor.chain().focus().insertContent(nodeToMove).run()
    }
    setMoveMode(null)
  }, [editor])

  const doExecCopy = useCallback((mm) => {
    if (!mm || !editor) return
    let nodeToCopy = null
    let insertPos = 0
    
    editor.state.doc.descendants((n, pos) => {
      if (nodeToCopy) return false
      const match = mm.type === 'image'  ? n.type.name==='image'&&n.attrs.src===mm.src
                  : mm.type === 'audio'  ? n.type.name==='driveAudio'&&n.attrs.driveId===mm.driveId
                  : mm.type === 'video'  ? n.type.name==='driveVideo'&&n.attrs.driveId===mm.driveId
                  : mm.type === 'pdf'    ? n.type.name==='drivePdf'&&n.attrs.driveId===mm.driveId
                  : n.type.name==='fileAttachment'&&n.attrs.filename===mm.filename
      if (match) {
        nodeToCopy = n.toJSON()
        insertPos = pos + n.nodeSize
      }
    })
    
    if (nodeToCopy) {
      editor.chain().focus().insertContentAt(insertPos, nodeToCopy).run()
    }
  }, [editor])

  const moveTouchRef = useRef(null)
  const handleEditorTouchStart = useCallback((e) => {
    if (!moveModeRef.current) return
    moveTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])

  const handleEditorTouchEnd = useCallback((e) => {
    if (!moveModeRef.current || !editor || !moveTouchRef.current) return
    const t = e.changedTouches[0]
    const dx = Math.abs(t.clientX - moveTouchRef.current.x)
    const dy = Math.abs(t.clientY - moveTouchRef.current.y)
    moveTouchRef.current = null
    if (dx > 12 || dy > 12) return
    e.preventDefault()

    const pos = editor.view.posAtCoords({ left: t.clientX, top: t.clientY })
    if (pos) {
      editor.commands.setTextSelection(pos.pos)
    }
    doExecMove()
  }, [editor, doExecMove])

  const handleEditorClickForMove = useCallback((e) => {
    if (!moveMode || !editor || e.detail === 0) return
    e.preventDefault(); e.stopPropagation()
    
    const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (pos) {
      editor.commands.setTextSelection(pos.pos)
    }
    doExecMove()
  }, [moveMode, editor, doExecMove])

  useImperativeHandle(ref, () => ({
    insertText: (text) => { if (!editor || isReadOnly) return; editor.chain().focus().insertContent(text).run() },
    insertFileAttachment: (filename, content) => { if (!editor || isReadOnly) return; editor.chain().focus().insertContent({ type: 'fileAttachment', attrs: { filename, content } }).run() },
  }), [editor, isReadOnly])



  // ── PDFファイル処理 ──
  const handlePdfFile = useCallback(async (file) => {
    if (!userId || !editor || isReadOnly) return
    setUploadingText('📑 PDFをアップロード中...')
    try {
      const token = await getValidDriveToken(settings)
      if (!token) throw new Error('トークンが無効です。設定から再連携してください。')
      const driveId = await uploadToGoogleDriveWithProgress(file, token, (pct) => {
        setUploadingText(`📑 PDFをアップロード中... ${pct}%`)
      })
      setUploadingText('📑 挿入中...')
      withScrollLock(editorAreaRef.current, () => {
        editor.chain().focus().insertContent({
          type: 'drivePdf',
          attrs: { driveId, filename: file.name }
        }).run()
      })
    } catch (err) {
      alert('⚠️ PDFの保存に失敗しました。\n詳細: ' + err.message)
    } finally {
      setUploadingText(null)
    }
  }, [userId, editor, isReadOnly, settings])

  // ── 動画ファイル処理 ──
  const handleVideoFile = useCallback(async (file) => {
    if (!userId || !editor || isReadOnly) return
    setUploadingText('🎬 動画をアップロード中... 0%')
    try {
      const token = await getValidDriveToken(settings)
      if (!token) throw new Error('トークンが無効です。設定から再連携してください。')
      const driveId = await uploadToGoogleDriveWithProgress(file, token, (pct) => {
        setUploadingText(`🎬 動画をアップロード中... ${pct}%`)
      })
      let thumbSrc = null
      try {
        const dataUrl = await extractVideoThumbnail(file)
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        const path = `${userId}/thumb_video_${Date.now()}.jpg`
        const { error } = await supabase.storage.from('images').upload(path, blob, { contentType: 'image/jpeg' })
        if (!error) {
          const { data } = supabase.storage.from('images').getPublicUrl(path)
          thumbSrc = data.publicUrl
        }
      } catch (e) { console.warn('サムネイル抽出失敗:', e) }
      setUploadingText('🎬 動画を挿入中...')
      withScrollLock(editorAreaRef.current, () => {
        editor.chain().focus().insertContent({
          type: 'driveVideo',
          attrs: { driveId, filename: file.name, thumbSrc, mimeType: file.type }
        }).run()
      })
    } catch (err) {
      alert('⚠️ 動画の保存に失敗しました。\n詳細: ' + err.message)
    } finally { setUploadingText(null) }
  }, [userId, editor, isReadOnly, settings])

  const handleAudioFile = useCallback(async (file) => {
    if (!userId || !editor || isReadOnly) return;
    setUploadingText('⏳ 音声を処理中...');
    
    try {
      const token = await getValidDriveToken(settings); // ★ 追加
      if (!token) throw new Error('トークンが無効です。設定から再連携してください。');
      const driveId = await uploadToGoogleDrive(file, token);
      
      withScrollLock(editorAreaRef.current, () => {
        editor.chain().focus().insertContent({
          type: 'driveAudio',
          attrs: { driveId, filename: file.name, mimeType: file.type }
        }).run();
      });
    } catch (err) {
      alert("⚠️ 音声の保存に失敗しました。\n詳細: " + err.message);
    } finally {
      setUploadingText(null);
    }
  }, [userId, editor, isReadOnly, settings])

  const handleImageFile = useCallback(async (file) => {
    if (!userId || !editor || isReadOnly) return; 
    setUploadingText('⏳ 画像を処理中...');
    
    try {
      let finalUrl = null;
      let driveId = null;

      try {
          const token = await getValidDriveToken(settings)
          if (!token) throw new Error('Drive再接続がキャンセルされました。');
          driveId = await uploadToGoogleDrive(file, token);
          const compressed = await compressImage(URL.createObjectURL(file), 0.6, 300);
          
          if (compressed) {
            const res = await fetch(compressed.dataUrl);
            const blob = await res.blob();
            const ext = file.name.split('.').pop() || 'jpg';
            const path = `${userId}/thumb_${Date.now()}.${ext}`;
            const { error } = await supabase.storage.from('images').upload(path, blob, { contentType: blob.type });
            if (error) throw error;
            
            const { data } = supabase.storage.from('images').getPublicUrl(path);
            finalUrl = data.publicUrl;
          }
        } catch (err) {
          const msg = err.message || ''
          if (msg.includes('insufficient') || msg.includes('UNAUTHENTICATED') || msg.includes('invalid_grant')) {
            alert("⚠️ Google Driveの認証が切れています。\n一度ログアウトして再ログインし、Drive連携を再承認してください。")
          } else {
            alert("⚠️ Google Driveへの保存に失敗しました。\n詳細: " + msg)
          }
          setUploadingText(null);
          return;
        }

      if (!finalUrl) {
        const ext = file.name.split('.').pop();
        const path = `${userId}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from('images').upload(path, file, { contentType: file.type });
        if (error) throw error;
        const { data } = supabase.storage.from('images').getPublicUrl(path);
        finalUrl = data.publicUrl;
      }

      withScrollLock(editorAreaRef.current, () => {
        editor.commands.setImage({ src: finalUrl, driveId: driveId });
      });

    } catch (e) { 
      alert('画像アップロード失敗: ' + e.message);
    } finally { 
      setUploadingText(null);
    }
  }, [userId, editor, isReadOnly, settings])

  const handleFile = useCallback(async (file) => {
    if (isReadOnly) return
    if (file.type.startsWith('image/')) {
       await handleImageFile(file)
    } else if (file.type.startsWith('video/')) {
       await handleVideoFile(file)
    } else if (file.type.startsWith('audio/')) {
       await handleAudioFile(file)
    } else if (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')) {
       await handlePdfFile(file)
    } else if (isTextFile(file)) { 
       const text = await file.text(); onTextFileDrop?.(file, text) 
    } else { 
       alert(`「${file.name}」は対応していないファイル形式です`)
    }
  }, [handleImageFile, handleAudioFile, handleVideoFile, handlePdfFile, onTextFileDrop, isReadOnly])

  const handleFileSelect = useCallback(() => {
    if (isReadOnly) return
    const inp = document.createElement('input'); 
    inp.type = 'file'; 
    inp.accept = 'image/*,audio/*,video/*,application/pdf,.pdf';
    inp.onchange = e => { const f = e.target.files?.[0]; if (f) handleFile(f) }; 
    inp.click()
  }, [handleFile, isReadOnly])

  const changeFontSize = useCallback((delta) => {
    if (!editor || isReadOnly) return
    const current = getCurrentFontSize(editor) || defaultFontSize
    const idx = FONT_SIZES.indexOf(current)
    let ni = idx === -1
      ? FONT_SIZES.indexOf(FONT_SIZES.reduce((p,c) => Math.abs(c-current)<Math.abs(p-current)?c:p)) + delta
      : idx + delta
    ni = Math.max(0, Math.min(FONT_SIZES.length-1, ni))
    const newSize = `${FONT_SIZES[ni]}px`

    withScrollLock(editorAreaRef.current, () => {
      editor.chain().focus().setFontSize(newSize).run()
      
      const { from, to } = editor.state.selection
      const tr = editor.state.tr
      let changed = false
      editor.state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === 'taskItem') {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, fontSize: newSize })
          changed = true
        }
      })
      if (changed) editor.view.dispatch(tr)
    })
  }, [editor, defaultFontSize, isReadOnly])

  const openFontSizeInput = useCallback(() => {
    if (!editor || isReadOnly) return
    const { from, to } = editor.state.selection
    savedSelectionRef.current = { from, to }
    const current = getCurrentFontSize(editor) || defaultFontSize
    setFontSizeInput(String(current))
    setEditingFontSize(true)
    setTimeout(() => { fontSizeInputRef.current?.focus(); fontSizeInputRef.current?.select() }, 20)
  }, [editor, defaultFontSize, isReadOnly])

  const commitFontSize = useCallback(() => {
    setEditingFontSize(false)
    const num = parseInt(fontSizeInput)
    if (!num || num < 6 || num > 200) { editor?.commands.focus(); return }
    const clamped = Math.max(6, Math.min(200, num))
    const newSize = `${clamped}px`

    if (editor) {
      editor.commands.focus()
      const sel = savedSelectionRef.current
      if (sel && sel.from !== sel.to) {
        editor.commands.setTextSelection({ from: sel.from, to: sel.to })
      }
      
      editor.chain().setFontSize(newSize).run()
      
      if (sel) {
        const tr = editor.state.tr
        let changed = false
        editor.state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
          if (node.type.name === 'taskItem') {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, fontSize: newSize })
            changed = true
          }
        })
        if (changed) editor.view.dispatch(tr)
      }
      
      if (sel && sel.from !== sel.to) {
        editor.commands.setTextSelection({ from: sel.from, to: sel.to })
      }
    }
    savedSelectionRef.current = null
  }, [editor, fontSizeInput])

  const toggleCodeBlockSmart = useCallback(() => {
    if (!editor || isReadOnly) return
    withScrollLock(editorAreaRef.current, () => {
      const { from, to } = editor.state.selection
      if (from === to) { editor.chain().focus().toggleCodeBlock().run(); return }
      const selectedText = editor.state.doc.textBetween(from, to, '\n')
      if (editor.isActive('codeBlock')) editor.chain().focus().toggleCodeBlock().run()
      else editor.chain().focus().deleteSelection().insertContent({ type: 'codeBlock', content: [{ type: 'text', text: selectedText }] }).run()
    })
  }, [editor, isReadOnly])

  const openContextMenu = useCallback((x, y, data) => {
    if (readOnly) return; 
    if (document.activeElement) document.activeElement.blur()
    setContextMenu({ x, y, ...data })
    g_lastContextMenuTime = Date.now() 
  }, [readOnly])

  useEffect(() => {
    const el = wrapperRef.current; if (!el) return
    const onCtx = (e) => {
      const img = e.target.closest('.tiptap img')
      const fa = e.target.closest('.file-attachment-node')
      const da = e.target.closest('.drive-audio-node')
      const dv = e.target.closest('.drive-video-node')
      const dp = e.target.closest('.drive-pdf-node')
      if (img) { e.preventDefault(); openContextMenu(e.clientX, e.clientY, { type: 'image', src: img.src, driveId: img.getAttribute('data-drive-id') }) }
      else if (fa) { e.preventDefault(); openContextMenu(e.clientX, e.clientY, { type: 'file', filename: fa.dataset.filename, content: fa.dataset.content }) }
      else if (da) { e.preventDefault(); openContextMenu(e.clientX, e.clientY, { type: 'audio', driveId: da.dataset.driveId, filename: da.dataset.filename }) }
      else if (dv) { e.preventDefault(); openContextMenu(e.clientX, e.clientY, { type: 'video', driveId: dv.dataset.driveId, filename: dv.dataset.filename }) }
      else if (dp) { e.preventDefault(); openContextMenu(e.clientX, e.clientY, { type: 'pdf', driveId: dp.dataset.driveId, filename: dp.dataset.filename }) }
    }

    let lpTimer = null, lpTouch = null
    const onTS = (e) => {
      if (moveModeRef.current) return
      const img = e.target.closest('.tiptap img')
      const fa = e.target.closest('.file-attachment-node')
      const da = e.target.closest('.drive-audio-node')
      const dv = e.target.closest('.drive-video-node')
      const dp = e.target.closest('.drive-pdf-node')
      if (!img && !fa && !da && !dv && !dp) return
      const t = e.touches[0]
      lpTouch = { img, fa, da, dv, dp, x: t.clientX, y: t.clientY }
      lpTimer = setTimeout(() => {
        if (!lpTouch) return
        if (navigator.vibrate) navigator.vibrate(30)
        if (lpTouch.img) openContextMenu(lpTouch.x, lpTouch.y, { type: 'image', src: lpTouch.img.src, driveId: lpTouch.img.getAttribute('data-drive-id') })
        else if (lpTouch.fa) openContextMenu(lpTouch.x, lpTouch.y, { type: 'file', filename: lpTouch.fa.dataset.filename, content: lpTouch.fa.dataset.content })
        else if (lpTouch.da) openContextMenu(lpTouch.x, lpTouch.y, { type: 'audio', driveId: lpTouch.da.dataset.driveId, filename: lpTouch.da.dataset.filename })
        else if (lpTouch.dv) openContextMenu(lpTouch.x, lpTouch.y, { type: 'video', driveId: lpTouch.dv.dataset.driveId, filename: lpTouch.dv.dataset.filename })
        else if (lpTouch.dp) openContextMenu(lpTouch.x, lpTouch.y, { type: 'pdf', driveId: lpTouch.dp.dataset.driveId, filename: lpTouch.dp.dataset.filename })
        lpTouch = null
      }, 500)
    }
    
    const onTE = () => { clearTimeout(lpTimer); lpTouch = null }
    const onTM = (e) => { 
      if (lpTouch) {
        const t = e.touches[0]
        const dx = Math.abs(t.clientX - lpTouch.x)
        const dy = Math.abs(t.clientY - lpTouch.y)
        if (dx > 10 || dy > 10) { clearTimeout(lpTimer); lpTouch = null }
      }
    }
    
    el.addEventListener('contextmenu', onCtx)
    el.addEventListener('touchstart', onTS, { passive: true })
    el.addEventListener('touchend', onTE)
    el.addEventListener('touchmove', onTM, { passive: true })
    
    return () => {
      el.removeEventListener('contextmenu', onCtx)
      el.removeEventListener('touchstart', onTS)
      el.removeEventListener('touchend', onTE)
      el.removeEventListener('touchmove', onTM)
    }
  }, [openContextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const close = (e) => { if (contextMenuRef.current?.contains(e.target)) return; setContextMenu(null) }
    const tid = setTimeout(() => document.addEventListener('pointerdown', close, true), 80)
    return () => { clearTimeout(tid); document.removeEventListener('pointerdown', close, true) }
  }, [contextMenu])

  const onDragOver = useCallback((e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setIsDragOver(true) }, [])
  const onDragLeave = useCallback((e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }, [])
  const onDrop = useCallback(async (e) => {
    if (isReadOnly) return
    e.preventDefault(); setIsDragOver(false)
    for (const f of Array.from(e.dataTransfer.files)) await handleFile(f)
  }, [handleFile, isReadOnly])

  const onEditorAreaClick = useCallback((e) => {
    if (moveMode) { handleEditorClickForMove(e); return }
    if (!editor) return
    if (editorAreaRef.current && !editorAreaRef.current.contains(e.target)) return
    if (e.target.closest('.ProseMirror')) return
    withScrollLock(editorAreaRef.current, () => editor.commands.focus('end'))
  }, [editor, moveMode, handleEditorClickForMove])

  const onToolbarMouseDown = useCallback((e) => {
    if (e.target.tagName === 'INPUT') return
    if (e.target.dataset.fontSizeLabel) return
    e.preventDefault()
  }, [])
  const onToolbarTouchStart = useCallback((e) => {
    if (e.target.tagName === 'INPUT') return
    if (e.target.dataset.fontSizeLabel) return
    e.preventDefault()
  }, [])

  const sl = useCallback((fn) => () => {
    if (!editor || isReadOnly) return
    withScrollLock(editorAreaRef.current, fn)
  }, [editor, isReadOnly])

  const insertDetails = useCallback(() => {
    if (!editor || isReadOnly) return
    if (editor.isActive('details')) { 
      const { state } = editor
      const { $from } = state.selection
      let detailsNode = null
      let detailsPos = null
      
      for (let i = $from.depth; i > 0; i--) {
        const n = $from.node(i)
        if (n.type.name === 'details') {
          detailsNode = n
          detailsPos = $from.before(i)
          break
        }
      }
      
      if (detailsNode && detailsPos !== null) {
        const newNodes = []
        detailsNode.content.forEach((child) => {
          if (child.type.name === 'detailsSummary') {
            newNodes.push(editor.schema.nodes.paragraph.create(null, child.content))
          } else {
            newNodes.push(child)
          }
        })
        editor.view.dispatch(state.tr.replaceWith(detailsPos, detailsPos + detailsNode.nodeSize, newNodes))
      }
      return
    }
    
    const { state } = editor
    const { from, to } = state.selection
    const hasSelection = from !== to

    if (!hasSelection) {
      const detailsNode = {
        type: 'details', attrs: { open: true },
        content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: 'タイトルをここに入力' }] },
          { type: 'paragraph' }
        ],
      }
      editor.chain().focus().insertContent(detailsNode).run()
      return
    }

    const slice = state.doc.slice(from, to)
    const contentJson = slice.content.toJSON() || []
    
    let summaryText = 'タイトルをここに入力'
    let bodyContent = contentJson

    if (contentJson.length > 0) {
      const firstNode = contentJson[0]
      if ((firstNode.type === 'paragraph' || firstNode.type === 'heading') && firstNode.content) {
        summaryText = firstNode.content.map(n => n.text || '').join('')
        bodyContent = contentJson.slice(1)
      } else if (firstNode.type === 'text') {
        summaryText = firstNode.text
        bodyContent = contentJson.slice(1)
      }
    }

    if (bodyContent.length === 0) {
      bodyContent = [{ type: 'paragraph' }]
    }

    const detailsNode = {
      type: 'details', attrs: { open: true },
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: summaryText }] },
        ...bodyContent
      ],
    }
    
    editor.chain().focus().deleteSelection().insertContent(detailsNode).run()
  }, [editor, isReadOnly])

  const applyLink = useCallback(() => {
    if (!editor) return
    const url = linkInput.trim()
    if (!url) {
      sl(() => editor.chain().focus().unsetLink().run())()
    } else {
      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
      sl(() => editor.chain().focus().setLink({ href, target: '_blank' }).run())()
    }
    setOpenPopover(null)
    setLinkInput('')
  }, [linkInput, editor, sl])

  const insertYoutube = useCallback(() => {
    if (!editor) return
    const url = linkInput.trim()
    if (!url) return
    const w = Math.min(640, (wrapperRef.current?.offsetWidth || 640) - 48)
    sl(() => editor.chain().focus().setYoutubeVideo({ src: url, width: w, height: Math.round(w * 9 / 16) }).run())()
    setOpenPopover(null)
    setLinkInput('')
  }, [linkInput, editor, sl])

  if (!editor) return null
  const currentFontSize = getCurrentFontSize(editor) || defaultFontSize
  const isAlign = a => editor.isActive({ textAlign: a })

  const TOOLBAR_RENDERERS = {
    fontSize: () => (
      <ToolGroup key="fontSize">
        <ToolBtn onClick={() => changeFontSize(-1)} title="文字を小さく" disabled={currentFontSize <= FONT_SIZES[0] || isReadOnly}>
          <span style={{fontSize:11}}>A</span><span style={{fontSize:8}}>▼</span>
        </ToolBtn>
        {editingFontSize ? (
          <input
            ref={fontSizeInputRef}
            type="number" min="6" max="200"
            value={fontSizeInput}
            onChange={e => setFontSizeInput(e.target.value)}
            onBlur={commitFontSize}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); commitFontSize() }
              if (e.key === 'Escape') { setEditingFontSize(false); editor?.commands.focus() }
            }}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            style={{ width:36, fontSize:12, border:'1.5px solid var(--accent)', borderRadius:4, textAlign:'center', padding:'1px 2px', background:'var(--bg)', color:'var(--text)', outline:'none', appearance:'textfield', MozAppearance:'textfield' }}
          />
        ) : (
          <span
            data-font-size-label="1"
            style={{ ...styles.sizeLabel, cursor:'pointer', borderRadius:3, padding:'1px 4px', minWidth:28 }}
            title="クリックで直接入力"
            onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
            onClick={openFontSizeInput}
            onTouchEnd={e => { e.preventDefault(); openFontSizeInput() }}
          >
            {currentFontSize}
          </span>
        )}
        <ToolBtn onClick={() => changeFontSize(1)} title="文字を大きく" disabled={currentFontSize >= FONT_SIZES[FONT_SIZES.length-1] || isReadOnly}>
          <span style={{fontSize:15}}>A</span><span style={{fontSize:8}}>▲</span>
        </ToolBtn>
      </ToolGroup>
    ),
    undo: () => <ToolGroup key="undo"><UndoRedoBtn editor={editor} type="undo" depth={undoDepth} editorAreaRef={editorAreaRef} disabled={isReadOnly} /></ToolGroup>,
    redo: () => <ToolGroup key="redo"><UndoRedoBtn editor={editor} type="redo" depth={redoDepth} editorAreaRef={editorAreaRef} disabled={isReadOnly} /></ToolGroup>,
    // ─ 見出し（H1〜H4）─
    heading: () => (
      <ToolGroup key="heading">
        {[1,2,3,4].map(level => (
          <ToolBtn
            key={`h${level}`}
            active={editor.isActive('heading', { level })}
            onClick={sl(() => editor.chain().focus().toggleHeading({ level }).run())}
            title={`見出し${level}`}
            disabled={isReadOnly}
            extraStyle={{ fontSize: level === 1 ? 13 : level === 2 ? 12 : 11, fontWeight: 700, letterSpacing: -0.5 }}
          >H{level}</ToolBtn>
        ))}
      </ToolGroup>
    ),
    bold: () => <ToolBtn key="bold" active={editor.isActive('bold')} onClick={sl(() => editor.chain().focus().toggleBold().run())} title="太字" disabled={isReadOnly} extraStyle={{fontWeight:900}}>B</ToolBtn>,
    italic: () => <ToolBtn key="italic" active={editor.isActive('italic')} onClick={sl(() => editor.chain().focus().toggleItalic().run())} title="斜体" disabled={isReadOnly} extraStyle={{fontStyle:'italic',fontWeight:700}}>I</ToolBtn>,
    underline: () => <ToolBtn key="underline" active={editor.isActive('underline')} onClick={sl(() => editor.chain().focus().toggleUnderline().run())} title="下線" disabled={isReadOnly} extraStyle={{textDecoration:'underline'}}>U</ToolBtn>,
    strike: () => <ToolBtn key="strike" active={editor.isActive('strike')} onClick={sl(() => editor.chain().focus().toggleStrike().run())} title="取り消し線" disabled={isReadOnly} extraStyle={{textDecoration:'line-through'}}>S</ToolBtn>,
    // ─ 文字色（ポップオーバー）─
    color: () => {
      const curColor = editor.getAttributes('textStyle').color
      return (
        <div key="color" style={{position:'relative'}}>
          <ToolBtn active={openPopover==='color'} onClick={()=>setOpenPopover(p=>p==='color'?null:'color')} title="文字色" disabled={isReadOnly}>
            <span style={{position:'relative',lineHeight:1,fontSize:14}}>A
              <span style={{position:'absolute',bottom:-2,left:0,right:0,height:3,borderRadius:2,background:curColor||'var(--text)'}}/>
            </span>
          </ToolBtn>
          {openPopover==='color' && (
            <TbPopover onClose={()=>setOpenPopover(null)}>
              <ColorGrid>
                <ColorDot color="var(--text)" active={!curColor} label="自" onClick={()=>{sl(()=>editor.chain().focus().unsetColor().run())();setOpenPopover(null)}}/>
                {COLORS.map(c=><ColorDot key={c} color={c} active={curColor===c} onClick={()=>{sl(()=>editor.chain().focus().setColor(c).run())();setOpenPopover(null)}}/>)}
              </ColorGrid>
            </TbPopover>
          )}
        </div>
      )
    },
    // ─ ハイライト（ポップオーバー）─
    highlight: () => {
      const curHL = editor.getAttributes('highlight').color
      return (
        <div key="highlight" style={{position:'relative'}}>
          <ToolBtn active={openPopover==='highlight'} onClick={()=>setOpenPopover(p=>p==='highlight'?null:'highlight')} title="ハイライト" disabled={isReadOnly}>
            <span style={{position:'relative',lineHeight:1,fontSize:13}}>蛍
              <span style={{position:'absolute',bottom:-2,left:0,right:0,height:3,borderRadius:2,background:curHL||'transparent',border:'1px solid var(--border)'}}/>
            </span>
          </ToolBtn>
          {openPopover==='highlight' && (
            <TbPopover onClose={()=>setOpenPopover(null)}>
              <ColorGrid>
                <ColorDot color="transparent" active={!curHL} label="無" dashed onClick={()=>{sl(()=>editor.chain().focus().unsetHighlight().run())();setOpenPopover(null)}}/>
                {HIGHLIGHTS.map(c=><ColorDot key={c} color={c} active={curHL===c} onClick={()=>{sl(()=>editor.chain().focus().toggleHighlight({color:c}).run())();setOpenPopover(null)}}/>)}
              </ColorGrid>
            </TbPopover>
          )}
        </div>
      )
    },
    // ─ 文字揃え（ポップオーバー）─
    align: () => (
      <div key="align" style={{position:'relative'}}>
        <ToolBtn active={openPopover==='align'} onClick={()=>setOpenPopover(p=>p==='align'?null:'align')} title="文字揃え" disabled={isReadOnly}>
          <AlignIcon type={['left','center','right'].find(a=>isAlign(a))||'left'}/>
        </ToolBtn>
        {openPopover==='align' && (
          <TbPopover onClose={()=>setOpenPopover(null)}>
            <div style={{display:'flex',gap:2}}>
              {['left','center','right'].map(a=>(
                <ToolBtn key={a} active={isAlign(a)} onClick={()=>{setTextAlignSmart(a)();setOpenPopover(null)}} title={a==='left'?'左揃え':a==='center'?'中央揃え':'右揃え'} disabled={isReadOnly}><AlignIcon type={a}/></ToolBtn>
              ))}
            </div>
          </TbPopover>
        )}
      </div>
    ),
    // ─ フォント選択（ポップオーバー）─
    font: () => {
      const curFont = editor.getAttributes('textStyle').fontFamily
      return (
        <div key="font" style={{position:'relative'}}>
          <ToolBtn active={openPopover==='font'} onClick={()=>setOpenPopover(p=>p==='font'?null:'font')} title="フォント選択" disabled={isReadOnly} extraStyle={{fontSize:11,fontWeight:700,letterSpacing:-0.5}}>Font</ToolBtn>
          {openPopover==='font' && (
            <TbPopover onClose={()=>setOpenPopover(null)}>
              <div style={{display:'flex',flexDirection:'column',gap:1,minWidth:190}}>
                {FONT_FAMILIES.map(f=>(
                  <button key={f.label} onMouseDown={e=>e.preventDefault()}
                    onClick={()=>{
                      if(f.value) sl(()=>editor.chain().focus().setFontFamily(f.value).run())()
                      else sl(()=>editor.chain().focus().unsetFontFamily().run())()
                      setOpenPopover(null)
                    }}
                    style={{display:'block',width:'100%',padding:'7px 12px',background:curFont===f.value?'var(--accent-bg)':'none',border:'none',borderRadius:6,textAlign:'left',fontSize:13,fontFamily:f.value?`'${f.value}',sans-serif`:'inherit',cursor:'pointer',color:curFont===f.value?'var(--accent)':'var(--text)',fontWeight:curFont===f.value?700:400}}
                  >{f.label}</button>
                ))}
              </div>
            </TbPopover>
          )}
        </div>
      )
    },
    bulletList: () => <ToolBtn key="bulletList" active={editor.isActive('bulletList')} onClick={sl(() => editor.chain().focus().toggleBulletList().run())} title="箇条書き" disabled={isReadOnly} extraStyle={{fontSize:14}}>≡</ToolBtn>,
    orderedList: () => <ToolBtn key="orderedList" active={editor.isActive('orderedList')} onClick={sl(() => editor.chain().focus().toggleOrderedList().run())} title="番号付きリスト" disabled={isReadOnly} extraStyle={{fontSize:11,fontWeight:700}}>1.</ToolBtn>,
    taskList: () => <ToolBtn key="taskList" active={editor.isActive('taskList')} onClick={sl(() => editor.chain().focus().toggleTaskList().run())} title="チェックボックス" disabled={isReadOnly} extraStyle={{fontSize:13}}>☑</ToolBtn>,
    blockquote: () => <ToolBtn key="blockquote" active={editor.isActive('blockquote')} onClick={sl(() => editor.chain().focus().toggleBlockquote().run())} title="引用" disabled={isReadOnly} extraStyle={{fontSize:14}}>❝</ToolBtn>,
    codeBlock: () => <ToolBtn key="codeBlock" active={editor.isActive('codeBlock')} onClick={toggleCodeBlockSmart} title="コードブロック" disabled={isReadOnly} extraStyle={{fontSize:10,fontFamily:'monospace'}}>{`</>`}</ToolBtn>,
    details: () => <ToolBtn key="details" active={editor.isActive('details')} onClick={insertDetails} title="折りたたみブロック" disabled={isReadOnly} extraStyle={{fontSize:13}}>▾</ToolBtn>,
    image: () => (
      <ToolBtn key="image" onClick={handleFileSelect} title="画像・音声・動画を挿入" disabled={!!uploadingText||isReadOnly} extraStyle={{fontSize:15}}>
        {uploadingText ? '⏳' : '📎'}
      </ToolBtn>
    ),
    // ─ 公開（ポップオーバー）─
    share: () => {
      const isPub = node?.is_public
      return (
        <div key="share" style={{position:'relative'}}>
          <ToolBtn active={openPopover==='share'||isPub} onClick={()=>setOpenPopover(p=>p==='share'?null:'share')} title={isPub?'公開中（タップで操作）':'Webに公開する'} disabled={isTrash} extraStyle={{fontSize:14,background:isPub?'#38a169':'transparent',color:isPub?'white':'var(--text)'}}>
            {isPub?'🌐':'🔒'}
          </ToolBtn>
          {openPopover==='share' && (
            <TbPopover onClose={()=>setOpenPopover(null)}>
              <div style={{display:'flex',flexDirection:'column',gap:4,minWidth:180,padding:4}}>
                {isPub ? (<>
                  <div style={{fontSize:11,color:'var(--text-muted)',padding:'2px 4px',fontWeight:600}}>🌐 現在公開中</div>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{onCopyPublicUrl?.(node.id);setOpenPopover(null)}}
                    style={{padding:'8px 12px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,fontSize:13,cursor:'pointer',fontWeight:600,textAlign:'left'}}>🔗 公開URLをコピー</button>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{onTogglePublic?.(node.id,false);setOpenPopover(null)}}
                    style={{padding:'8px 12px',background:'#fee2e2',color:'#dc2626',border:'none',borderRadius:8,fontSize:13,cursor:'pointer',fontWeight:600,textAlign:'left'}}>🔒 公開を停止する</button>
                </>) : (<>
                  <div style={{fontSize:11,color:'var(--text-muted)',padding:'2px 4px'}}>このノードをWebに公開します</div>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{onTogglePublic?.(node.id,true);setOpenPopover(null)}}
                    style={{padding:'8px 12px',background:'#38a169',color:'white',border:'none',borderRadius:8,fontSize:13,cursor:'pointer',fontWeight:600,textAlign:'left'}}>🌐 公開する</button>
                </>)}
              </div>
            </TbPopover>
          )}
        </div>
      )
    },
    // ─ ホーム（このノードをホーム画面のショートカットとして追加）─
    home: () => (
      <ToolBtn key="home"
        onClick={() => { if(node) setHomeShortcutModal(true) }}
        title="このノードをホーム画面のショートカットとして追加"
        disabled={!node||isTrash} extraStyle={{fontSize:15}}>🏠</ToolBtn>
    ),
    // ─ リマインダー ─
    reminder: () => (
      <ToolBtn key="reminder" onClick={()=>node&&onOpenReminder?.(node)} title="リマインダーを設定" disabled={!node||isTrash} extraStyle={{fontSize:14}}>⏰</ToolBtn>
    ),
    // ─ エクスポート ─
    export: () => (
      <ToolBtn key="export" onClick={()=>setExportModal(true)} title="ノードをエクスポート" disabled={!node||isTrash} extraStyle={{fontSize:11,fontWeight:700,letterSpacing:-1,position:'relative'}}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{position:'absolute',opacity:0.25}}><path d="M3 2h10v12H3z"/></svg>
        <span style={{position:'relative',fontSize:9,fontWeight:900,lineHeight:1}}>out</span>
      </ToolBtn>
    ),
    // ─ インポート ─
    import: () => (
      <ToolBtn key="import" onClick={()=>{
        const inp = document.createElement('input')
        inp.type = 'file'; inp.accept = '.nmmm1,.nmmmg,.nmmmf'
        inp.onchange = async (e) => {
          const file = e.target.files?.[0]; if (!file) return
          setImporting(true)
          try { await onImportFile?.(file) } finally { setImporting(false) }
        }
        inp.click()
      }} title="ノードをインポート" disabled={importing} extraStyle={{fontSize:11,fontWeight:700,letterSpacing:-1,position:'relative'}}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{position:'absolute',opacity:0.25}}><path d="M3 2h10v12H3z"/></svg>
        <span style={{position:'relative',fontSize:9,fontWeight:900,lineHeight:1}}>{importing?'…':'in'}</span>
      </ToolBtn>
    ),
    // ─ リンク ─
    link: () => {
      const isActive = editor.isActive('link')
      const currentUrl = editor.getAttributes('link').href || ''
      return (
        <div key="link" style={{position:'relative'}}>
          <ToolBtn active={isActive||openPopover==='link'} onClick={()=>{ setLinkInput(isActive?currentUrl:''); setOpenPopover(p=>p==='link'?null:'link') }} title="リンク" disabled={isReadOnly} extraStyle={{fontSize:13}}>
            🔗
          </ToolBtn>
          {openPopover==='link' && (
            <TbPopover onClose={()=>{setOpenPopover(null);setLinkInput('')}}>
              <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:220,padding:2}}>
                <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:600}}>{isActive?'リンクを編集':'リンクを挿入'}</div>
                <input ref={linkInputRef} value={linkInput} onChange={e=>setLinkInput(e.target.value)}
                  onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();applyLink()}if(e.key==='Escape'){setOpenPopover(null);setLinkInput('')}}}
                  onMouseDown={e=>e.stopPropagation()} placeholder="https://..."
                  style={{padding:'6px 10px',fontSize:13,border:'1.5px solid var(--border)',borderRadius:6,background:'var(--bg)',color:'var(--text)',outline:'none',width:'100%',boxSizing:'border-box'}}
                  autoFocus
                />
                <div style={{display:'flex',gap:4}}>
                  <button onMouseDown={e=>e.preventDefault()} onClick={applyLink}
                    style={{flex:1,padding:'6px 0',background:'var(--accent)',color:'white',border:'none',borderRadius:6,fontSize:12,cursor:'pointer',fontWeight:600}}>
                    {isActive?'更新':'挿入'}
                  </button>
                  {isActive && (
                    <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().unsetLink().run())();setOpenPopover(null);setLinkInput('')}}
                      style={{padding:'6px 10px',background:'#fee2e2',color:'#dc2626',border:'none',borderRadius:6,fontSize:12,cursor:'pointer',fontWeight:600}}>削除</button>
                  )}
                </div>
              </div>
            </TbPopover>
          )}
        </div>
      )
    },
    // ─ テーブル ─
    table: () => {
      const isInTable = editor.isActive('table')
      const tmBtn = {display:'block',width:'100%',padding:'7px 12px',background:'none',border:'none',borderRadius:6,textAlign:'left',fontSize:13,cursor:'pointer',color:'var(--text)',whiteSpace:'nowrap'}
      const tmBtnDanger = {...tmBtn,color:'#dc2626'}
      return (
        <div key="table" style={{position:'relative'}}>
          <ToolBtn active={isInTable||openPopover==='table'} onClick={()=>setOpenPopover(p=>p==='table'?null:'table')} title="テーブル" disabled={isReadOnly} extraStyle={{fontSize:13,fontWeight:700}}>⊞</ToolBtn>
          {openPopover==='table' && (
            <TbPopover onClose={()=>setOpenPopover(null)}>
              <div style={{display:'flex',flexDirection:'column',gap:1,minWidth:170}}>
                {!isInTable ? (
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run())();setOpenPopover(null)}} style={tmBtn}>📊 テーブル挿入 (3×3)</button>
                ) : (<>
                  <div style={{fontSize:10,color:'var(--text-muted)',padding:'2px 8px',fontWeight:700}}>行</div>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().addRowBefore().run())();setOpenPopover(null)}} style={tmBtn}>↑ 上に行を追加</button>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().addRowAfter().run())();setOpenPopover(null)}} style={tmBtn}>↓ 下に行を追加</button>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().deleteRow().run())();setOpenPopover(null)}} style={tmBtnDanger}>✕ 行を削除</button>
                  <div style={{fontSize:10,color:'var(--text-muted)',padding:'4px 8px 2px',fontWeight:700}}>列</div>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().addColumnBefore().run())();setOpenPopover(null)}} style={tmBtn}>← 左に列を追加</button>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().addColumnAfter().run())();setOpenPopover(null)}} style={tmBtn}>→ 右に列を追加</button>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().deleteColumn().run())();setOpenPopover(null)}} style={tmBtnDanger}>✕ 列を削除</button>
                  <div style={{fontSize:10,color:'var(--text-muted)',padding:'4px 8px 2px',fontWeight:700}}>セル</div>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().mergeCells().run())();setOpenPopover(null)}} style={tmBtn}>⊞ セルを結合</button>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().splitCell().run())();setOpenPopover(null)}} style={tmBtn}>⊟ セルを分割</button>
                  <div style={{margin:'4px 0 0',borderTop:'1px solid var(--border)'}}/>
                  <button onMouseDown={e=>e.preventDefault()} onClick={()=>{sl(()=>editor.chain().focus().deleteTable().run())();setOpenPopover(null)}} style={tmBtnDanger}>🗑 テーブルを削除</button>
                </>)}
              </div>
            </TbPopover>
          )}
        </div>
      )
    },
    // ─ YouTube ─
    youtube: () => (
      <div key="youtube" style={{position:'relative'}}>
        <ToolBtn active={openPopover==='youtube'} onClick={()=>{setLinkInput('');setOpenPopover(p=>p==='youtube'?null:'youtube')}} title="YouTube動画を埋め込む" disabled={isReadOnly} extraStyle={{fontSize:13}}>▶️</ToolBtn>
        {openPopover==='youtube' && (
          <TbPopover onClose={()=>{setOpenPopover(null);setLinkInput('')}}>
            <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:240,padding:2}}>
              <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:600}}>YouTube URLを貼り付け</div>
              <input value={linkInput} onChange={e=>setLinkInput(e.target.value)}
                onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();insertYoutube()}if(e.key==='Escape'){setOpenPopover(null);setLinkInput('')}}}
                onMouseDown={e=>e.stopPropagation()} placeholder="https://www.youtube.com/watch?v=..."
                style={{padding:'6px 10px',fontSize:13,border:'1.5px solid var(--border)',borderRadius:6,background:'var(--bg)',color:'var(--text)',outline:'none',width:'100%',boxSizing:'border-box'}}
                autoFocus
              />
              <button onMouseDown={e=>e.preventDefault()} onClick={insertYoutube}
                style={{padding:'6px 0',background:'var(--accent)',color:'white',border:'none',borderRadius:6,fontSize:12,cursor:'pointer',fontWeight:600}}>埋め込む</button>
            </div>
          </TbPopover>
        )}
      </div>
    ),
    // ─ 子孫まとめ ─
    childrenSummary: () => (
      <ToolBtn key="childrenSummary"
        onClick={() => {
          if (!node || isTrash || isReadOnly) return
          editor?.chain().focus().insertContent({
            type: 'childrenSummaryBlock',
            attrs: { label: `📋 子孫まとめ（${node.title}）` },
          }).run()
        }}
        title="子孫ノードのまとめブロックを挿入（クリックで展開）"
        disabled={!node || isTrash || isReadOnly}
        extraStyle={{fontSize:13, fontWeight:700}}>📋</ToolBtn>
    ),
    // ─ 目次 ─
    tableOfContents: () => (
      <ToolBtn key="tableOfContents"
        onClick={() => {
          if (!node || isTrash || isReadOnly) return
          editor?.chain().focus().insertContent({ type: 'tableOfContentsBlock' }).run()
        }}
        title="目次ブロックを挿入（見出しをリアルタイム反映）"
        disabled={!node || isTrash || isReadOnly}
        extraStyle={{ fontSize: 13, fontWeight: 700 }}>≡</ToolBtn>
    ),
  }

  const GROUP_IDS = new Set(['bold','italic','underline','strike','bulletList','orderedList','taskList','blockquote','codeBlock','details','image'])
  const toolbarElements = []
  let groupBuffer = []
  enabledItems.forEach((id, idx) => {
    const renderer = TOOLBAR_RENDERERS[id]; if (!renderer) return
    if (GROUP_IDS.has(id)) { groupBuffer.push(renderer()) } else {
      if (groupBuffer.length > 0) { toolbarElements.push(<ToolGroup key={`g${idx}`}>{groupBuffer}</ToolGroup>); toolbarElements.push(<Divider key={`d${idx}a`} />); groupBuffer = [] }
      else if (toolbarElements.length > 0) toolbarElements.push(<Divider key={`d${idx}`} />)
      toolbarElements.push(renderer())
    }
  })
  if (groupBuffer.length > 0) { if (toolbarElements.length > 0) toolbarElements.push(<Divider key="dlast" />); toolbarElements.push(<ToolGroup key="glast">{groupBuffer}</ToolGroup>) }

  return (
    <div ref={wrapperRef} style={{ ...styles.wrapper, outline:isDragOver?'3px solid var(--accent)':'none', outlineOffset:-3, cursor:moveMode?'crosshair':undefined }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onEditorAreaClick}
    >
      <style>{`
        .ProseMirror img {
          display: inline-block !important;
        }
        .ProseMirror img.ProseMirror-selectednode,
        .ProseMirror .file-attachment-node.ProseMirror-selectednode,
        .ProseMirror .drive-audio-node.ProseMirror-selectednode {
          outline: 3px solid var(--accent) !important;
          outline-offset: 2px;
          border-radius: 4px;
        }
        .ProseMirror a { color: var(--accent); text-decoration: underline; cursor: pointer; }
        .ProseMirror a:hover { opacity: 0.75; }
        .mention { background: var(--accent-bg); color: var(--accent); border-radius: 4px; padding: 1px 4px; font-weight: 600; cursor: pointer; text-decoration: none; }
        .ProseMirror table { border-collapse: collapse; margin: 8px 0; width: max-content; max-width: 100%; }
        .ProseMirror td, .ProseMirror th { border: 1px solid var(--border); padding: 6px 10px; min-width: 60px; vertical-align: top; font-size: inherit; }
        .ProseMirror th { background: var(--surface); font-weight: 700; }
        .ProseMirror .selectedCell { background: var(--accent-bg); }
        .ProseMirror .tableWrapper { overflow-x: auto; }
        .ProseMirror iframe[src*="youtube"] { border-radius: 8px; margin: 8px 0; display: block; max-width: 100%; }
      `}</style>

      {isDragOver && <div style={styles.dropOverlay}><div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,color:'white'}}><span style={{fontSize:32}}>📂</span><span style={{fontSize:15,fontWeight:600}}>ここにドロップ</span></div></div>}
      {moveMode && (
        <div style={styles.moveModeBar}>
          <span>{moveMode.type === 'image' ? '🖼 画像' : moveMode.type === 'audio' ? `🎵 「${moveMode.filename}」` : `📄 「${moveMode.filename}」`}を移動 — 移動先をタップ</span>
          <button style={styles.moveModeCancel} onMouseDown={e=>e.preventDefault()} onClick={() => setMoveMode(null)}>キャンセル</button>
        </div>
      )}
      {!toolbarCollapsed && !isReadOnly && (
        <div style={styles.toolbar} onMouseDown={onToolbarMouseDown} onTouchStart={onToolbarTouchStart}>
          {toolbarElements}
          {/* visibility:hidden でスペースを保持しつつ非表示 → レイアウトシフトなし */}
          <span style={{ ...styles.savingLabel, visibility: saving ? 'visible' : 'hidden' }}>保存中…</span>
        </div>
      )}
      {/* 画面右下に固定表示 → レイアウト（行位置）に影響しない */}
      {saving && !isReadOnly && (
        <div style={styles.savingToast}>保存中…</div>
      )}
      {isTrash && <div style={styles.trashReadonlyBar}>🗑 このノードはごみ箱内のため読み取り専用です</div>}
      
      <div ref={editorAreaRef} style={{ ...styles.editorArea, ...(isReadOnly && !readOnly ? styles.editorAreaTrash : {}) }}
        onTouchStart={moveMode ? handleEditorTouchStart : undefined}
        onTouchEnd={moveMode ? handleEditorTouchEnd : undefined}
      >
        <EditorContent editor={editor} style={{ minHeight:'100%' }} />
      </div>
      <ImageModal settings={settings} />
      
      {fileViewer && !readOnly && (
        <div style={styles.fileViewerOverlay} onClick={() => setFileViewer(null)}>
          <div style={styles.fileViewer} onClick={e=>e.stopPropagation()}>
            <div style={styles.fileViewerHeader}>
              <span style={styles.fileViewerTitle}>📄 {fileViewer.filename}</span>
              <button style={styles.fileViewerClose} onClick={() => setFileViewer(null)}>✕</button>
            </div>
            <pre style={styles.fileViewerContent}>{fileViewer.content}</pre>
          </div>
        </div>
      )}
      {contextMenu && (
        <ContextMenu menuRef={contextMenuRef} menu={contextMenu} editor={editor} editorAreaRef={editorAreaRef} settings={settings}
          onClose={() => setContextMenu(null)}
          onStartMove={(data) => { setContextMenu(null); setTimeout(() => setMoveMode(data), 150) }}
          onMoveToOtherNode={(data) => { setContextMenu(null); setTimeout(() => setNodeTransferModal(data), 150) }}
          onCopyNode={(data) => { setContextMenu(null); setTimeout(() => doExecCopy(data), 150) }}
          onStartCompress={(src) => {
            setContextMenu(null)
            compressImage(src, 0.7).then(result => {
              if (!result) return
              fetch(src).then(r=>r.blob()).then(blob => setCompressDialog({ originalSrc:src, compressedDataUrl:result.dataUrl, originalSize:blob.size, compressedSize:Math.round(result.dataUrl.length*0.75) })).catch(() => setCompressDialog({ originalSrc:src, compressedDataUrl:result.dataUrl, originalSize:null, compressedSize:Math.round(result.dataUrl.length*0.75) }))
            })
          }}
        />
      )}
      {compressDialog && <CompressDialog dialog={compressDialog} editor={editor} editorAreaRef={editorAreaRef} userId={userId} onClose={() => setCompressDialog(null)} />}
      {exportModal && node && (
        <ExportModal
          node={node}
          allNodes={allNodes || []}
          userId={userId}
          settings={settings}
          onClose={() => setExportModal(false)}
        />
      )}
      {homeShortcutModal && node && (
        <HomeShortcutModal node={node} onClose={() => setHomeShortcutModal(false)} />
      )}
      {childrenSummaryOpen && node && (
        <ChildrenSummaryModal
          node={node}
          allNodes={allNodes || []}
          onClose={() => setChildrenSummaryOpen(false)}
        />
      )}
      {nodeTransferModal && (
        <NodeTransferModal
          data={nodeTransferModal}
          allNodes={allNodes || []}
          currentNodeId={node?.id}
          onTransfer={async (targetNodeId) => {
            await onNavigateAttachment?.(nodeTransferModal, targetNodeId, node?.id, editor)
            setNodeTransferModal(null)
          }}
          onClose={() => setNodeTransferModal(null)}
        />
      )}
      
      {uploadingText && (() => {
        const pctMatch = uploadingText.match(/(\d+)%/)
        const pct = pctMatch ? parseInt(pctMatch[1]) : null
        return (
          <div style={{ position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)', background:'rgba(20,20,20,0.92)', color:'white', padding:'12px 20px', borderRadius:12, fontSize:13, fontWeight:600, zIndex:1000, boxShadow:'0 8px 24px rgba(0,0,0,0.3)', display:'flex', flexDirection:'column', alignItems:'center', gap:8, backdropFilter:'blur(8px)', minWidth:240 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:16 }}>⏳</span>
              <span>{uploadingText}</span>
            </div>
            {pct !== null && (
              <div style={{ width:'100%', height:6, background:'rgba(255,255,255,0.2)', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${pct}%`, background:'#5b6af0', borderRadius:3, transition:'width 0.3s ease' }} />
              </div>
            )}
          </div>
        )
      })()}
      {settings?.showCharCount && (
        <div style={{padding:'2px 12px',fontSize:11,color:'var(--text-muted)',borderTop:'1px solid var(--border)',background:'var(--surface)',flexShrink:0,textAlign:'right',userSelect:'none'}}>
          {editor.storage.characterCount.characters().toLocaleString()} 文字 / {editor.storage.characterCount.words().toLocaleString()} 単語
        </div>
      )}
      {mentionState && mentionState.items.length > 0 && (
        <MentionDropdown state={mentionState} keyHandlerRef={mentionKeyHandlerRef} />
      )}
    </div>
  )
})

function CompressDialog({ dialog, editor, editorAreaRef, userId, onClose }) {
  const [applying, setApplying] = useState(false)
  const fmt = b => b==null?'不明':b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(2)} MB`
  const pct = dialog.originalSize ? Math.round((1 - dialog.compressedSize/dialog.originalSize)*100) : null

  const handleApply = async () => {
    setApplying(true)
    try {
      const res = await fetch(dialog.compressedDataUrl)
      const blob = await res.blob()
      const path = `${userId}/${Date.now()}_compressed.jpg`
      const { error } = await supabase.storage.from('images').upload(path, blob, { contentType:'image/jpeg' })
      if (error) throw error
      const { data } = supabase.storage.from('images').getPublicUrl(path)
      const newSrc = data.publicUrl

      try {
        const url = new URL(dialog.originalSrc)
        const parts = url.pathname.split('/object/public/images/')
        if (parts.length === 2) await supabase.storage.from('images').remove([parts[1]])
      } catch {}

      let replaced = false
      editor.state.doc.descendants((node, pos) => {
        if (replaced || node.type.name !== 'image' || node.attrs.src !== dialog.originalSrc) return
        replaced = true
        withScrollLock(editorAreaRef.current, () => {
          editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, src:newSrc }); return true }).run()
        })
      })
      onClose()
    } catch(e) { alert('圧縮画像の保存に失敗: ' + e.message) }
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
            <p style={{ fontSize:12, color:'var(--text)', marginTop:6 }}>{fmt(dialog.compressedSize)}{pct!=null&&<span style={{ color:'#38a169', marginLeft:6 }}>▼{pct}%削減</span>}</p>
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
  const can = !disabled && (type==='undo' ? editor.can().undo() : editor.can().redo())
  const icon = type === 'undo' ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M3 13C5.33 8.9 9.5 6 14 6c4.42 0 8 3.58 8 8s-3.58 8-8 8c-3 0-5.65-1.65-7.09-4.1"/></svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M21 13C18.67 8.9 14.5 6 10 6c-4.42 0-8 3.58-8 8s3.58 8 8 8c3 0 5.65-1.65 7.09-4.1"/></svg>
  )
  return (
    <button title={type==='undo'?'元に戻す':'やり直し'} disabled={!can}
      onMouseDown={e=>e.preventDefault()}
      onClick={() => withScrollLock(editorAreaRef.current, () => { type==='undo' ? editor.chain().focus().undo().run() : editor.chain().focus().redo().run() })}
      style={{ ...styles.toolBtn, background:'transparent', color:can?'var(--text)':'var(--text-muted)', opacity:can?1:0.4, position:'relative', width:32 }}
    >
      {icon}
      {depth > 0 && <span style={{ position:'absolute', bottom:0, right:0, fontSize:8, fontWeight:700, color:can?'var(--accent)':'var(--text-muted)', lineHeight:1 }}>{depth}</span>}
    </button>
  )
}

function ContextMenu({ menuRef, menu, editor, editorAreaRef, onClose, onStartMove, onMoveToOtherNode, onCopyNode, onStartCompress, settings }) {
  const { x, y, type, src, filename, content, driveId } = menu
  const menuX = Math.min(x, window.innerWidth - 210)
  const menuY = Math.min(y, window.innerHeight - 300)

  const make = (fn) => (e) => { e.stopPropagation(); e.preventDefault(); fn(); onClose() }

  let curWidth = null
  const maxW = Math.max(100, (editorAreaRef.current?.clientWidth||800) - 56)

  if (editor && type === 'image') {
    editor.state.doc.descendants((node) => {
      if (curWidth !== null) return
      if (node.type.name === 'image' && node.attrs.src === src) {
        if (node.attrs.style) { const m = node.attrs.style.match(/width:\s*(\d+)px/); if(m) curWidth = parseInt(m[1]) }
        if (curWidth === null && node.attrs.width) curWidth = parseInt(node.attrs.width)
      }
    })
    if (curWidth === null) {
      const el = editorAreaRef.current?.querySelector(`img[src="${src}"]`)
      if (el) curWidth = el.offsetWidth
    }
  }
  
  const isMax = curWidth !== null && curWidth >= maxW
  const isMin = curWidth !== null && curWidth <= 50

  // ★ 変更：ダウンロード時もトークン生存確認
  const downloadMedia = async () => {
    try {
      if (driveId && settings?.googleDriveToken) {
        // PDFはDrive APIでダウンロードURLを取得してからblob DL
        if (type === 'pdf') {
          const token = await getValidDriveToken(settings)
          if (token) {
            try {
              // webContentLinkが使えればそちらを優先（直接DL）
              const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?fields=webContentLink,name`, {
                headers: { Authorization: `Bearer ${token}` }
              }).then(r => r.json())
              if (meta.webContentLink) {
                const a = document.createElement('a')
                a.href = meta.webContentLink
                a.download = meta.name || filename || 'document.pdf'
                a.target = '_blank'
                document.body.appendChild(a); a.click(); document.body.removeChild(a)
                return
              }
            } catch (e) { console.warn('webContentLink取得失敗:', e) }
          }
          // フォールバック：export=download URL
          window.open(`https://drive.google.com/uc?export=download&id=${driveId}`, '_blank')
          return
        }
        const token = await getValidDriveToken(settings);
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) throw new Error('Driveからのダウンロードに失敗しました。')
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = filename || `downloaded_media.${type==='audio'?'mp3':'jpg'}`
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
        return
      }

      if (type === 'image' && src) {
        const res = await fetch(src); const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `image.${blob.type.split('/')[1]||'jpg'}`
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      }
    } catch { if (src) window.open(src, '_blank') }
  }

  const downloadFile = () => {
    const blob = new Blob([content||''], { type:'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename||'file.txt'
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const adjustSize = (delta) => {
    if (!editor || type !== 'image') return
    let done = false
    editor.state.doc.descendants((node, pos) => {
      if (done || node.type.name !== 'image' || node.attrs.src !== src) return
      done = true
      let cur = null
      if (node.attrs.style) { const m = node.attrs.style.match(/width:\s*(\d+)px/); if(m) cur=parseInt(m[1]) }
      if (cur===null && node.attrs.width) cur = parseInt(node.attrs.width)||null
      if (cur===null) { const el = editorAreaRef.current?.querySelector(`img[src="${src}"]`); cur = el ? el.offsetWidth : 300 }
      const nw = Math.max(50, Math.min(maxW, cur + delta))
      withScrollLock(editorAreaRef.current, () => {
        editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, width:nw, style:`max-width:${nw}px;width:${nw}px;height:auto;max-height:none;` }); return true }).run()
      })
    })
  }

  // ★ 変更：削除時もトークン生存確認
  const deleteNode = async () => {
    if (!editor) return
    let done = false
    
    if (type === 'image' && src) {
      try {
        const url = new URL(src)
        const parts = url.pathname.split('/object/public/images/')
        if (parts.length === 2) await supabase.storage.from('images').remove([parts[1]])
      } catch (e) { console.error('Storageからの画像削除に失敗:', e) }
    }
    
    if ((type === 'image' || type === 'audio' || type === 'video' || type === 'pdf') && driveId && settings?.googleDriveToken) {
      try {
        const token = await getValidDriveToken(settings);
        await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        })
      } catch (e) { console.error('Driveからのファイル削除に失敗:', e) }
    }
    
    editor.state.doc.descendants((node, pos) => {
      if (done) return false
      const match = type==='image' ? node.type.name==='image'&&node.attrs.src===src 
                  : type==='file'  ? node.type.name==='fileAttachment'&&node.attrs.filename===filename
                  : type==='audio' ? node.type.name==='driveAudio'&&node.attrs.driveId===driveId
                  : type==='video' ? node.type.name==='driveVideo'&&node.attrs.driveId===driveId
                  : type==='pdf'   ? node.type.name==='drivePdf'&&node.attrs.driveId===driveId
                  : false;
      if (!match) return
      done = true
      withScrollLock(editorAreaRef.current, () => {
        editor.chain().command(({ tr }) => { tr.delete(pos, pos+node.nodeSize); return true }).run()
      })
    })
  }

  const items = [
    { label: (type === 'image' && driveId && settings?.googleDriveToken) ? '⬇ 原寸大をダウンロード' : '⬇ ダウンロード', action: (type==='image'||type==='audio'||type==='video'||type==='pdf') ? downloadMedia : downloadFile },
    ...(type==='image' ? [
      { label:'🔍− 縮小 (−80px)', action:()=>adjustSize(-80), disabled: isMin },
      { label:'🔍+ 拡大 (+80px)', action:()=>adjustSize(+80), disabled: isMax },
      { label:'🗜 画質を下げて容量削減', action:()=>{ onStartCompress(src) } },
    ] : []),
    { label:'📌 このノード内で移動', action:()=>{ onStartMove({ type, src, filename, content, driveId }) } },
    { label:'📂 別ノードに移動', action:()=>{ onMoveToOtherNode?.({ type, src, filename, content, driveId }) } },
    { label:'📑 複製', action:()=>{ onCopyNode({ type, src, filename, content, driveId }) } },
    { label:'🗑 削除', action:deleteNode, danger:true },
  ]

  return (
    <div ref={menuRef}
      style={{ position:'fixed', left:menuX, top:menuY, zIndex:500, background:'var(--bg)', border:'1.5px solid var(--border)', borderRadius:10, boxShadow:'0 6px 24px rgba(0,0,0,0.18)', overflow:'hidden', minWidth:200 }}
      onPointerDown={e=>e.stopPropagation()}
    >
      {items.map((item,i) => (
        <button key={i}
          disabled={item.disabled}
          onMouseDown={item.disabled ? undefined : make(item.action)}
          onTouchStart={item.disabled ? undefined : make(item.action)}
          style={{ 
            display:'block', width:'100%', padding:'12px 16px', background:'none', border:'none', 
            borderBottom:i<items.length-1?'1px solid var(--border)':'none', textAlign:'left', 
            fontSize:14, cursor: item.disabled ? 'default' : 'pointer', 
            color: item.disabled ? 'var(--text-muted)' : (item.danger?'#dc2626':'var(--text)'),
            opacity: item.disabled ? 0.4 : 1
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function ToolBtn({ active, disabled, onClick, children, title, extraStyle }) {
  return (
    <button title={title} disabled={disabled}
      onMouseDown={e=>e.preventDefault()}
      onTouchStart={e=>e.preventDefault()}
      onClick={onClick}
      style={{ ...styles.toolBtn, background:active?'var(--accent)':'transparent', color:active?'white':disabled?'var(--text-muted)':'var(--text)', opacity:disabled?0.4:1, ...extraStyle }}
    >
      {children}
    </button>
  )
}

function AlignIcon({ type }) {
  const configs = { left:[{x:2,w:16},{x:2,w:11},{x:2,w:16},{x:2,w:9}], center:[{x:2,w:16},{x:5,w:10},{x:2,w:16},{x:6,w:8}], right:[{x:2,w:16},{x:7,w:11},{x:2,w:16},{x:9,w:9}] }[type]
  return <svg width="18" height="14" viewBox="0 0 20 16" fill="currentColor">{configs.map((l,i)=><rect key={i} x={l.x} y={i*4} width={l.w} height={2} rx={1}/>)}</svg>
}

// ── ★ 画像プレビュー（クリック時）の処理 ──
function ImageModal({ settings }) {
  const [targetData, setTargetData] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  
  useEffect(() => {
    const onClick = e => { 
      if (Date.now() - g_lastContextMenuTime < 500) return;
      if(e.target.tagName==='IMG'&&e.target.closest('.tiptap')&&e.button===0) {
        setTargetData({
          src: e.target.src,
          driveId: e.target.getAttribute('data-drive-id')
        })
      }
    }
    
    let touchMoved = false
    const onTS = () => { touchMoved = false }
    const onTM = () => { touchMoved = true }
    
    document.addEventListener('click', onClick, true)
    document.addEventListener('touchstart', onTS, { passive: true })
    document.addEventListener('touchmove', onTM, { passive: true })
    
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('touchstart', onTS)
      document.removeEventListener('touchmove', onTM)
    }
  }, [])

  useEffect(() => {
    if (!targetData) {
      if (blobUrl && blobUrl.startsWith('blob:')) { URL.revokeObjectURL(blobUrl); setBlobUrl(null); }
      return;
    }
    
    let isMounted = true;
    const fetchOriginal = async () => {
      if (targetData.driveId) {
        setLoading(true)
        try {
          if (settings?.googleDriveToken) {
            const token = await getValidDriveToken(settings); // ★ 変更：トークン生存確認
            if (!isMounted) return;
            if (token) {
              const res = await fetch(`https://www.googleapis.com/drive/v3/files/${targetData.driveId}?alt=media`, {
                headers: { Authorization: `Bearer ${token}` }
              })
              if (res.ok) {
                const blob = await res.blob()
                setBlobUrl(URL.createObjectURL(blob))
              } else {
                setBlobUrl(targetData.src)
              }
              setShowModal(true)
            }
          } else {
            // トークンがない場合（公開ビューアーなど）
            const highResUrl = `https://drive.google.com/thumbnail?id=${targetData.driveId}&sz=w4000-h4000`;
            const img = new window.Image();
            img.onload = () => {
              if (isMounted) { setBlobUrl(highResUrl); setShowModal(true); setLoading(false); }
            };
            img.onerror = () => {
              if (isMounted) { setBlobUrl(targetData.src); setShowModal(true); setLoading(false); }
            };
            img.src = highResUrl;
            return;
          }
        } catch (e) {
          if (isMounted) { setBlobUrl(targetData.src); setShowModal(true); }
        } finally {
          if (isMounted) setLoading(false)
        }
      } else {
        setBlobUrl(targetData.src)
        setShowModal(true)
      }
    }
    fetchOriginal()
    return () => { isMounted = false; }
  }, [targetData, settings])
  
  const close = () => {
    setTargetData(null)
    setShowModal(false)
  }

  if (loading && !showModal) {
    return (
      <div style={styles.toast}>
        <span style={{ animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>⏳</span>
        高画質画像を読み込み中...
        <style>{`@keyframes spin { 100% { transform:rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!showModal) return null

  return (
    <div style={styles.modal} onClick={close}>
      <img src={blobUrl || targetData.src} alt="" style={styles.modalImg} onClick={e=>e.stopPropagation()} />
      <button style={styles.modalClose} onClick={close}>✕</button>
    </div>
  )
}


// ── ツールバーポップオーバー ──
// ★ ポイント：onMouseDownでpreventDefaultしてエディタfocusを奪わない
function TbPopover({ children, onClose }) {
  const ref = useRef(null)
  const [alignRight, setAlignRight] = useState(false)

  useEffect(() => {
    // マウント後に右端チェック → はみ出すなら右寄せに切り替え
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      if (rect.right > window.innerWidth - 8) {
        setAlignRight(true)
      }
    }
  }, [])

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const tid = setTimeout(() => document.addEventListener('pointerdown', h, true), 80)
    return () => { clearTimeout(tid); document.removeEventListener('pointerdown', h, true) }
  }, [onClose])

  return (
    <div ref={ref}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      style={{
        position:'absolute', top:'calc(100% + 4px)', zIndex:600,
        left: alignRight ? 'auto' : 0,
        right: alignRight ? 0 : 'auto',
        background:'var(--bg)', border:'1.5px solid var(--border)',
        borderRadius:10, boxShadow:'0 6px 24px rgba(0,0,0,0.2)',
        padding:'8px', minWidth:'max-content',
        // 初期描画時は左端で一瞬表示されるのを防ぐため透明にしてからフェードイン
        opacity: 1,
      }}>
      {children}
    </div>
  )
}
// ── メンション候補ドロップダウン ──
function MentionDropdown({ state, keyHandlerRef }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedRef = useRef(0)

  const selectItem = useCallback((idx) => {
    if (state.items[idx]) {
      state.command({ id: state.items[idx].id, label: state.items[idx].label })
    }
  }, [state])

  useEffect(() => {
    keyHandlerRef.current = (event) => {
      if (event.key === 'ArrowUp') {
        const next = (selectedRef.current - 1 + state.items.length) % state.items.length
        selectedRef.current = next; setSelectedIndex(next); return true
      }
      if (event.key === 'ArrowDown') {
        const next = (selectedRef.current + 1) % state.items.length
        selectedRef.current = next; setSelectedIndex(next); return true
      }
      if (event.key === 'Enter') { selectItem(selectedRef.current); return true }
      return false
    }
    return () => { keyHandlerRef.current = null }
  }, [state.items, selectItem, keyHandlerRef])

  useEffect(() => { selectedRef.current = 0; setSelectedIndex(0) }, [state.items])

  const rect = state.clientRect?.()
  if (!rect) return null

  const popStyle = {
    position:'fixed', left: Math.min(rect.left, window.innerWidth - 200),
    top: rect.bottom + 4, zIndex:1200,
    background:'var(--bg)', border:'1.5px solid var(--border)',
    borderRadius:8, boxShadow:'0 6px 24px rgba(0,0,0,0.2)',
    padding:4, minWidth:160, maxWidth:280, maxHeight:280, overflowY:'auto',
  }

  return ReactDOM.createPortal(
    <div style={popStyle}>
      {state.items.map((item, i) => (
        <button key={item.id}
          onMouseDown={e=>e.preventDefault()}
          onClick={()=>selectItem(i)}
          style={{display:'block',width:'100%',padding:'7px 12px',background:i===selectedIndex?'var(--accent-bg)':'none',border:'none',borderRadius:6,textAlign:'left',fontSize:13,cursor:'pointer',color:i===selectedIndex?'var(--accent)':'var(--text)',fontWeight:i===selectedIndex?600:400}}
        >{item.label}</button>
      ))}
    </div>,
    document.body
  )
}

function ColorGrid({ children }) {
  return <div style={{display:'flex',flexWrap:'wrap',gap:3,maxWidth:186}}>{children}</div>
}
function ColorDot({ color, active, onClick, label, dashed }) {
  return (
    <button onMouseDown={e=>e.preventDefault()} onClick={onClick}
      style={{ width:20, height:20, borderRadius:4, flexShrink:0, cursor:'pointer', outline:'none',
        background: color==='transparent'?'var(--surface)':color,
        border: dashed?'1.5px dashed var(--border)':active?'2.5px solid var(--accent)':'1.5px solid rgba(0,0,0,0.12)',
        boxShadow: active?'0 0 0 2px var(--accent-bg)':'none',
        display:'flex', alignItems:'center', justifyContent:'center' }}>
      {label && <span style={{fontSize:8,fontWeight:900,color:'var(--text-muted)',lineHeight:1}}>{label}</span>}
    </button>
  )
}


// ═══════════════════════════════════════════════════════
// ExportModal + エクスポート/インポートロジック
// ═══════════════════════════════════════════════════════

// Supabase画像URLをbase64に変換
async function imageUrlToBase64(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

// HTMLコンテンツ内のSupabase画像をbase64に差し替え
async function embedImagesToBase64(html, onProgress) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const imgs = Array.from(doc.querySelectorAll('img[src]'))
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i]
    const src = img.getAttribute('src')
    if (src && src.startsWith('http') && !src.startsWith('data:')) {
      onProgress?.(`画像を埋め込み中… ${i+1}/${imgs.length}`)
      const b64 = await imageUrlToBase64(src)
      if (b64) img.setAttribute('src', b64)
    }
  }
  return doc.body.innerHTML
}

// ノードツリーを深さ優先で取得
function collectDescendants(nodeId, allNodes) {
  const result = []
  const visit = (id) => {
    const children = allNodes.filter(n => n.parent_id === id).sort((a,b) => (a.position||0)-(b.position||0))
    for (const c of children) { result.push(c); visit(c.id) }
  }
  visit(nodeId)
  return result
}

function ExportModal({ node, allNodes, userId, settings, onClose }) {
  const [mode, setMode] = useState('single') // 'single' | 'subtree' | 'all'
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState('')

  const handleExport = async () => {
    setExporting(true)
    setProgress('⏳ エクスポートを準備中...')
    try {
      if (mode === 'single') {
        // nmmm1: 単一ノード
        setProgress('🖼 画像を埋め込み中...')
        const embeddedContent = await embedImagesToBase64(node.content || '', setProgress)
        const data = {
          format: 'nmmm1',
          version: 1,
          exportedAt: new Date().toISOString(),
          node: {
            title: node.title,
            content: embeddedContent,
            title_style: node.title_style || null,
          }
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const filename = `${node.title.replace(/[/\:*?"<>|]/g, '_')}.nmmm1`
        downloadBlob(blob, filename)
        setProgress('✅ エクスポート完了')
        setTimeout(onClose, 1000)
      } else {
        // nmmmf: 現在ノード＋子孫すべて
        const descendants = collectDescendants(node.id, allNodes)
        const targetNodes = [node, ...descendants]
        const exportedNodes = []
        for (let i = 0; i < targetNodes.length; i++) {
          const n = targetNodes[i]
          setProgress(`🖼 画像を埋め込み中… (${i+1}/${targetNodes.length}) ${n.title}`)
          const embeddedContent = await embedImagesToBase64(n.content || '', () => {})
          exportedNodes.push({
            id: n.id,
            title: n.title,
            content: embeddedContent,
            parent_id: n.parent_id,
            position: n.position,
            title_style: n.title_style || null,
            is_expanded: n.is_expanded,
          })
        }
        const data = {
          format: 'nmmmf',
          version: 1,
          exportedAt: new Date().toISOString(),
          rootId: node.id,
          nodes: exportedNodes,
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const filename = `${node.title.replace(/[/\:*?"<>|]/g, '_')}.nmmmf`
        downloadBlob(blob, filename)
        setProgress('✅ エクスポート完了')
        setTimeout(onClose, 1000)
      }
    } catch (err) {
      setProgress(`❌ エラー: ${err.message}`)
      setTimeout(() => setExporting(false), 3000)
    }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={exporting?undefined:onClose}>
      <div style={{background:'var(--bg)',borderRadius:16,width:340,maxWidth:'92vw',boxShadow:'0 20px 60px rgba(0,0,0,0.25)',overflow:'hidden',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px 10px',borderBottom:'1px solid var(--border)'}}>
          <span style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>📤 ノードをエクスポート</span>
          {!exporting && <button onClick={onClose} style={{background:'none',border:'none',fontSize:16,cursor:'pointer',color:'var(--text-muted)'}}>✕</button>}
        </div>
        {progress && (
          <div style={{padding:'8px 16px',background:'var(--accent-bg)',fontSize:13,color:'var(--accent)',fontWeight:600,borderBottom:'1px solid var(--border)'}}>{progress}</div>
        )}
        {!exporting && (
          <div style={{padding:'16px'}}>
            <p style={{fontSize:12,color:'var(--text-muted)',marginBottom:14}}>対象ノード：<strong>{node.title}</strong></p>
            <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
              {[
                { value:'single',   label:'📄 現在のノードのみ',     sub:'.nmmm1 形式', desc:'このノード1つをエクスポート' },
                { value:'subtree',  label:'🗂 このノードと全子孫',   sub:'.nmmmg 形式', desc:`このノード＋子孫 ${collectDescendants(node.id,allNodes).length}件をツリー構造ごとエクスポート` },
                { value:'all',      label:'🗃 全ノード（全カテゴリ）',sub:'.nmmmf 形式', desc:`全 ${allNodes.filter(n=>!n.content?.includes('__TRASH__')).length}件をエクスポート` },
              ].map(opt => (
                <label key={opt.value} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 12px',border:`2px solid ${mode===opt.value?'var(--accent)':'var(--border)'}`,borderRadius:10,cursor:'pointer',background:mode===opt.value?'var(--accent-bg)':'transparent'}}>
                  <input type="radio" name="mode" value={opt.value} checked={mode===opt.value} onChange={()=>setMode(opt.value)} style={{marginTop:2}}/>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:'var(--text)'}}>{opt.label} <span style={{fontSize:10,color:'var(--text-muted)',fontWeight:400}}>{opt.sub}</span></div>
                    <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
            <p style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>※ Supabase画像はファイルに埋め込まれます。Google Drive内のファイルはIDのみ記録されます。</p>
            <button onClick={handleExport} style={{width:'100%',padding:'11px',background:'var(--accent)',border:'none',borderRadius:10,fontSize:14,color:'white',cursor:'pointer',fontWeight:700}}>
              ⬇ エクスポート
            </button>
          </div>
        )}
        {exporting && (
          <div style={{padding:40,textAlign:'center',color:'var(--text-muted)',display:'flex',flexDirection:'column',gap:12,alignItems:'center'}}>
            <div style={{fontSize:36,animation:'spin 1s linear infinite',display:'inline-block'}}>⏳</div>
            <div style={{fontSize:13}}>エクスポート中…少々お待ちください</div>
          </div>
        )}
      </div>
    </div>
  )
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ── ノード間移動モーダル ──
function NodeTransferModal({ data, allNodes, currentNodeId, onTransfer, onClose }) {
  const [search, setSearch] = useState('')
  const [transferring, setTransferring] = useState(false)
  const icon = data.type==='image'?'🖼':data.type==='audio'?'🎵':data.type==='video'?'🎬':'📄'
  const label = data.filename||(data.type==='image'?'画像':data.type==='video'?'動画':'添付ファイル')

  // ツリー表示順に並べる（深さ優先・親→子の順）
  // ツリー順に並べる（深さ優先・親→子）
  // currentNodeId自身は除外するが、その子孫は移動先として選択できる
  // ★ visitはallNodesを使って経路を辿り、結果に追加する時のみ除外判定する
  const buildTreeOrder = useCallback(() => {
    const trashIds = new Set(
      allNodes.filter(n => n.content?.includes('__TRASH__')).map(n => n.id)
    )
    const result = []
    const visit = (parentId, depth) => {
      const children = allNodes
        .filter(n => (n.parent_id || null) === parentId)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
      for (const n of children) {
        // ごみ箱は完全スキップ（子孫も辿らない）
        if (trashIds.has(n.id)) continue
        // currentNode自身は表示しないが子孫は辿る
        if (n.id !== currentNodeId) {
          result.push({ ...n, _depth: Math.min(depth, 5) })
        }
        visit(n.id, depth + 1)
      }
    }
    visit(null, 0)
    return result
  }, [allNodes, currentNodeId])

  const treeOrder = buildTreeOrder()
  const filtered = search
    ? treeOrder.filter(n => (n.title||'').toLowerCase().includes(search.toLowerCase()))
    : treeOrder

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'var(--bg)',borderRadius:16,width:360,maxWidth:'92vw',maxHeight:'70vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.25)',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'14px 16px 10px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontWeight:700,fontSize:15,color:'var(--text)'}}>📂 別ノードに移動</span>
            <button onClick={onClose} style={{background:'none',border:'none',fontSize:16,cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
          </div>
          <p style={{fontSize:12,color:'var(--text-muted)',margin:'6px 0 10px'}}>{icon} {label} を移動するノードを選択</p>
          <input type="text" placeholder="ノードを検索…" value={search} onChange={e=>setSearch(e.target.value)} autoFocus
            style={{width:'100%',padding:'7px 10px',fontSize:13,border:'1px solid var(--border)',borderRadius:8,background:'var(--surface)',color:'var(--text)',outline:'none',boxSizing:'border-box'}}/>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {filtered.length===0 ? (
            <div style={{padding:20,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>{search?'一致するノードが見つかりません':'ノードがありません'}</div>
          ) : filtered.map(n => {
            const depth = n._depth ?? 0
            return (
              <button key={n.id} disabled={transferring}
                onClick={async()=>{setTransferring(true);await onTransfer(n.id)}}
                style={{display:'flex',alignItems:'center',width:'100%',padding:`9px 16px 9px ${16+depth*14}px`,background:'none',border:'none',borderBottom:'1px solid var(--border)',textAlign:'left',fontSize:13,color:'var(--text)',cursor:'pointer',boxSizing:'border-box',gap:6}}>
                {depth>0&&<span style={{color:'var(--border)',fontSize:10,flexShrink:0}}>└</span>}
                <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>📄 {n.title||'無題'}</span>
              </button>
            )
          })}
        </div>
        {transferring&&<div style={{padding:'10px 16px',borderTop:'1px solid var(--border)',fontSize:12,color:'var(--text-muted)',textAlign:'center'}}>移動中…</div>}
      </div>
    </div>
  )
}

// ── 子孫まとめモーダル ──
function ChildrenSummaryModal({ node, allNodes, onClose }) {
  // 子孫ノードを深さ優先で収集（ごみ箱は除外）
  const trashIds = new Set(allNodes.filter(n => n.content?.includes('__TRASH__')).map(n => n.id))

  const collectDescendants = (parentId, depth = 0) => {
    const children = allNodes
      .filter(n => (n.parent_id || null) === parentId && !trashIds.has(n.id) && n.id !== node.id)
      .sort((a, b) => (a.position || 0) - (b.position || 0))
    const result = []
    for (const child of children) {
      result.push({ ...child, _depth: depth })
      result.push(...collectDescendants(child.id, depth + 1))
    }
    return result
  }

  const descendants = collectDescendants(node.id)

  // HTMLタグを除いてプレーンテキスト化（まとめ表示の補助）
  const stripHtml = (html) => {
    if (!html) return ''
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    return tmp.textContent || ''
  }

  const hasContent = (n) => {
    const text = stripHtml(n.content || '').trim()
    return text.length > 0 && !text.includes('__TRASH__')
  }

  const shown = descendants.filter(n => hasContent(n) || true) // タイトルだけでも表示

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'var(--bg)',borderRadius:16,width:'min(700px, 94vw)',maxHeight:'85vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.25)',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
        {/* ヘッダー */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px 12px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>📋 子孫まとめ</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>「{node.title}」の子孫ノード {shown.length} 件</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'var(--text-muted)',padding:4}}>✕</button>
        </div>
        {/* 本体 */}
        <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>
          {shown.length === 0 ? (
            <div style={{textAlign:'center',color:'var(--text-muted)',fontSize:14,padding:40}}>子孫ノードがありません</div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:0}}>
              {shown.map((desc, i) => {
                const indent = (desc._depth || 0) * 16
                const nodeHasContent = hasContent(desc)
                return (
                  <div key={desc.id} style={{
                    background: 'rgba(20, 160, 100, 0.07)',
                    border: '1px solid rgba(20, 160, 100, 0.18)',
                    borderRadius: 10,
                    marginBottom: 12,
                    marginLeft: indent,
                    overflow: 'hidden',
                  }}>
                    {/* ノードタイトル */}
                    <div style={{
                      display:'flex',alignItems:'center',gap:8,
                      padding:'10px 14px',
                      background:'rgba(20, 160, 100, 0.13)',
                      borderBottom: nodeHasContent ? '1px solid rgba(20, 160, 100, 0.18)' : 'none',
                    }}>
                      <span style={{fontSize:13,color:'rgba(10,100,60,0.7)',flexShrink:0}}>
                        {'└'.repeat(Math.min(desc._depth, 1))}
                      </span>
                      <span style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>
                        {desc.title || '無題'}
                      </span>
                    </div>
                    {/* ノード本文 */}
                    {nodeHasContent && (
                      <div
                        style={{padding:'12px 16px',fontSize:13,color:'var(--text)',lineHeight:1.7,overflowX:'auto'}}
                        dangerouslySetInnerHTML={{__html: desc.content || ''}}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {/* フッター */}
        <div style={{padding:'10px 20px',borderTop:'1px solid var(--border)',flexShrink:0,display:'flex',justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{padding:'8px 20px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,fontSize:13,cursor:'pointer',color:'var(--text)'}}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

// ── ホーム画面ショートカット追加モーダル ──
function HomeShortcutModal({ node, onClose }) {
  const nodeUrl = `${window.location.origin}${window.location.pathname}?node=${encodeURIComponent(node.id)}`
  const ua = navigator.userAgent.toLowerCase()
  const isAndroid = ua.includes('android')
  const isIOS = /iphone|ipad/.test(ua)
  const isPC = !isAndroid && !isIOS

  const [copied, setCopied] = useState(false)

  const copyUrl = () => {
    navigator.clipboard?.writeText(nodeUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => alert(nodeUrl))
  }

  // ブラウザで開く（ノード名をURLに付与してタブタイトルに使えるよう準備）
  const openInBrowser = () => {
    // App.jsxのuseEffectが?node=でノードを開きタイトルも設定するので
    // そのURLをそのまま開くだけでOK
    const a = document.createElement('a')
    a.href = nodeUrl
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => document.body.removeChild(a), 100)
  }

  const steps = isIOS ? [
    { icon: '1', text: 'このモーダル下の「ブラウザで開く」を押す' },
    { icon: '2', text: 'Safariが開いたら、下部の共有ボタン（□↑）をタップ' },
    { icon: '3', text: '「ホーム画面に追加」をタップ' },
    { icon: '4', text: '名前を確認して「追加」をタップ' },
  ] : isAndroid ? [
    { icon: '1', text: 'このモーダル下の「ブラウザで開く」を押す' },
    { icon: '2', text: 'Chromeが開いたら、右上のメニュー（⋮）をタップ' },
    { icon: '3', text: '「ホーム画面に追加」をタップ' },
    { icon: '4', text: '名前を確認して「追加」をタップ' },
  ] : [
    { icon: '1', text: '下の「URLをコピー」を押す' },
    { icon: '2', text: 'ブラウザのアドレスバーに貼り付けて開く' },
    { icon: '3', text: 'Chromeなら：右上メニュー → キャスト、保存、共有 → ショートカットを作成' },
    { icon: '4', text: 'Edgeなら：右上メニュー → アプリ → このサイトをアプリとしてインストール' },
  ]

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--bg)', borderRadius:16, width:360, maxWidth:'92vw', maxHeight:'85vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.25)', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* ヘッダー */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 16px 12px', borderBottom:'1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>🏠 ホーム画面に追加</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:260 }}>
              {node.title}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'var(--text-muted)', padding:4 }}>✕</button>
        </div>

        {/* 手順 */}
        <div style={{ flex:1, overflowY:'auto', padding:'14px 16px' }}>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:12 }}>
            このノードをホーム画面のショートカットとして追加する手順：
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                <div style={{ width:24, height:24, borderRadius:'50%', background:'var(--accent)', color:'white', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  {s.icon}
                </div>
                <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.6, paddingTop:2 }}>{s.text}</div>
              </div>
            ))}
          </div>

          {/* URL表示 */}
          <div style={{ marginTop:16, padding:'8px 12px', background:'var(--surface)', borderRadius:8, border:'1px solid var(--border)', fontSize:11, color:'var(--text-muted)', wordBreak:'break-all', lineHeight:1.5 }}>
            {nodeUrl}
          </div>
        </div>

        {/* フッターボタン */}
        <div style={{ display:'flex', gap:8, padding:'10px 16px 14px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
          <button onClick={copyUrl}
            style={{ flex:1, padding:'10px 0', background: copied ? '#38a169' : 'var(--surface)', border:'1px solid var(--border)', borderRadius:10, fontSize:13, color: copied ? 'white' : 'var(--text)', cursor:'pointer', fontWeight:600 }}>
            {copied ? '✅ コピーしました' : '📋 URLをコピー'}
          </button>
          {(isAndroid || isIOS) && (
            <button onClick={openInBrowser}
              style={{ flex:1, padding:'10px 0', background:'var(--accent)', border:'none', borderRadius:10, fontSize:13, color:'white', cursor:'pointer', fontWeight:700 }}>
              🌐 ブラウザで開く
            </button>
          )}
          {isPC && (
            <button onClick={onClose}
              style={{ flex:1, padding:'10px 0', background:'var(--accent)', border:'none', borderRadius:10, fontSize:13, color:'white', cursor:'pointer', fontWeight:700 }}>
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


function ToolGroup({ children }) { return <div style={styles.toolGroup}>{children}</div> }
function Divider() { return <div style={styles.divider} /> }

const styles = {
  wrapper: { display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', position:'relative' },
  toolbar: { display:'flex', alignItems:'center', flexWrap:'wrap', gap:2, padding:'5px 10px', borderBottom:'1px solid var(--border)', background:'var(--surface)', flexShrink:0 },
  savingBar: { padding:'3px 12px', fontSize:11, color:'var(--text-muted)', background:'var(--surface)', borderBottom:'1px solid var(--border)', flexShrink:0 },
  savingToast: { position:'fixed', bottom:16, right:16, padding:'4px 12px', fontSize:11, color:'rgba(255,255,255,0.9)', background:'rgba(0,0,0,0.55)', borderRadius:20, pointerEvents:'none', zIndex:200, backdropFilter:'blur(4px)' },
  trashReadonlyBar: { padding:'6px 16px', fontSize:12, color:'#92400e', background:'#fef3c7', borderBottom:'1px solid #fcd34d', flexShrink:0 },
  toolGroup: { display:'flex', alignItems:'center', gap:1 },
  toolBtn: { border:'none', borderRadius:5, width:28, height:26, cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center', transition:'background 0.1s', flexShrink:0, padding:0 },
  sizeLabel: { fontSize:11, color:'var(--text-muted)', minWidth:22, textAlign:'center', fontVariantNumeric:'tabular-nums' },
  colorBtn: { width:16, height:16, borderRadius:3, border:'none', cursor:'pointer', flexShrink:0, margin:'0 1px' },
  divider: { width:1, height:18, background:'var(--border)', margin:'0 3px', flexShrink:0 },
  savingLabel: { marginLeft:'auto', fontSize:11, color:'var(--text-muted)' },
  editorArea: { flex:1, overflowY:'auto', cursor:'text' },
  editorAreaTrash: { opacity:0.55, cursor:'default', pointerEvents:'none' },
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
  toast: { position: 'absolute', bottom: 24, right: 24, background: 'rgba(0,0,0,0.8)', color: 'white', padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: 8 },
}