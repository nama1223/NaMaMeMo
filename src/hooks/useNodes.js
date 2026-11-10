import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'
import {
  cacheNodes, getCachedNodes,
  markNodeDirty, markNodeDeleted,
  getPendingSync, clearPendingSync,
} from '../utils/offlineDB'
import { withTimeout } from '../utils/withTimeout'

// ごみ箱ノードの特別ID（ユーザーごとにDBに保存される特殊ノード）
export const TRASH_NODE_TITLE = '🗑 ごみ箱'
export const TRASH_NODE_MARKER = '__TRASH_NODE__' // contentに埋め込むマーカー

export function useNodes(userId, categoryId) {
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const lastSavedContent = useRef({})
  const onExternalUpdateRef = useRef(null)
  // 最新のノード配列への参照（オフライン書き込み時に使用）
  const nodesRef = useRef([])

  const selfWrites = useRef(new Map())
  const SELF_WRITE_TTL = 15000

  const markSelfWrite = useCallback((id, content = null) => {
    selfWrites.current.set(id, { ts: Date.now(), content })
  }, [])

  const isSelfWrite = useCallback((id, incomingContent = null) => {
    const entry = selfWrites.current.get(id)
    if (!entry) return false
    if (Date.now() - entry.ts > SELF_WRITE_TTL) {
      selfWrites.current.delete(id)
      return false
    }
    if (incomingContent !== null && entry.content !== null) {
      return entry.content === incomingContent
    }
    return true
  }, [])

  // nodesRef を nodes と同期
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  const fetchNodes = useCallback(async () => {
    if (!userId || !categoryId) { setNodes([]); setLoading(false); return }
    // 通信が宙吊りになると await が返らず読み込みが終わらないため 8 秒で見切る。
    // タイムアウト・例外は error と同じ経路に入れてキャッシュ復元を必ず試みる
    let data, error
    try {
      ;({ data, error } = await withTimeout(
        supabase
          .from('nodes').select('*')
          .eq('user_id', userId).eq('category_id', categoryId)
          .order('position', { ascending: true }),
        8000,
        'nodes fetch timeout'
      ))
    } catch (e) {
      data = null
      error = e
    }
    if (!error) {
      const ns = data || []
      setNodes(ns)
      nodesRef.current = ns
      const map = {}
      ns.forEach(n => { map[n.id] = n.content || '' })
      lastSavedContent.current = map
      // オンライン取得成功 → キャッシュ更新
      cacheNodes(userId, categoryId, ns).catch(() => {})
    } else {
      // エラー時 → オフラインキャッシュから復元
      const cached = await getCachedNodes(userId, categoryId)
      if (cached) {
        console.warn('[useNodes] fetch error – using offline cache')
        setNodes(cached)
        nodesRef.current = cached
        const map = {}
        cached.forEach(n => { map[n.id] = n.content || '' })
        lastSavedContent.current = map
      }
    }
    setLoading(false)
  }, [userId, categoryId])

  useEffect(() => { setLoading(true); fetchNodes() }, [fetchNodes])

  // ── ごみ箱ノードを取得または作成 ──
  const getOrCreateTrashNode = useCallback(async () => {
    // 既存のごみ箱を探す
    const existing = nodes.find(n => n.content?.includes(TRASH_NODE_MARKER))
    if (existing) return existing

    // DBからも探す（他カテゴリにある場合）
    const { data: allNodes } = await supabase
      .from('nodes')
      .select('*')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
    const dbTrash = (allNodes || []).find(n => n.content?.includes(TRASH_NODE_MARKER))
    if (dbTrash) return dbTrash

    // なければ作成
    const roots = nodes.filter(n => n.parent_id === null)
    const maxPos = roots.length > 0 ? Math.max(...roots.map(n => n.position)) : -1
    const { data, error } = await supabase.from('nodes').insert({
      user_id: userId,
      category_id: categoryId,
      title: TRASH_NODE_TITLE,
      content: TRASH_NODE_MARKER,
      position: maxPos + 1,
      is_expanded: true,
      parent_id: null,
    }).select().single()
    if (error) { console.error('ごみ箱作成失敗:', error); return null }
    markSelfWrite(data.id, TRASH_NODE_MARKER)
    setNodes(prev => [...prev, data])
    lastSavedContent.current[data.id] = TRASH_NODE_MARKER
    return data
  }, [nodes, userId, categoryId, markSelfWrite])

  // ごみ箱ノードかどうか判定
  const isTrashNode = useCallback((nodeId) => {
    const n = nodes.find(n => n.id === nodeId)
    return n?.content?.includes(TRASH_NODE_MARKER) ?? false
  }, [nodes])

  // ごみ箱に入っているかどうか（親を再帰的に辿る）
  const isInTrash = useCallback((nodeId) => {
    let n = nodes.find(n => n.id === nodeId)
    while (n) {
      if (n.content?.includes(TRASH_NODE_MARKER)) return true
      n = nodes.find(p => p.id === n.parent_id)
    }
    return false
  }, [nodes])

  // ── Realtime ──
  useEffect(() => {
    if (!userId || !categoryId) return
    const channelName = `nodes-${userId}-${categoryId}-v2`
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'nodes',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload
        const id = newRow?.id || oldRow?.id
        const rowCategoryId = newRow?.category_id || oldRow?.category_id

        if (rowCategoryId && rowCategoryId !== categoryId) return

        if (eventType === 'UPDATE' && newRow && isSelfWrite(id, newRow.content)) return
        if (eventType !== 'UPDATE' && id && isSelfWrite(id)) return

        onExternalUpdateRef.current?.()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId, categoryId, isSelfWrite])

  const registerExternalUpdateHandler = useCallback((fn) => {
    onExternalUpdateRef.current = fn
  }, [])

  // ── オフライン同期ヘルパー ───────────────────────────────────
  // オフライン書き込み後にノード配列とキャッシュを更新する共通処理
  const applyOfflineWrite = useCallback(async (newNodes, dirtyNode = null, deletedId = null) => {
    setNodes(newNodes)
    nodesRef.current = newNodes
    await cacheNodes(userId, categoryId, newNodes).catch(() => {})
    if (dirtyNode) await markNodeDirty(userId, dirtyNode).catch(() => {})
    if (deletedId) await markNodeDeleted(userId, deletedId).catch(() => {})
  }, [userId, categoryId])

  const reorderAndSave = useCallback(async (orderedSiblings) => {
    if (!navigator.onLine) {
      // オフライン時は位置だけ更新してダーティマーク
      const newNodes = nodesRef.current.map(n => {
        const idx = orderedSiblings.findIndex(s => s.id === n.id)
        return idx >= 0 ? { ...n, position: idx } : n
      })
      await applyOfflineWrite(newNodes)
      for (const [i, n] of orderedSiblings.entries()) {
        await markNodeDirty(userId, { ...n, position: i }).catch(() => {})
      }
      return
    }
    await Promise.all(
      orderedSiblings.map((n, i) => {
        markSelfWrite(n.id)
        return supabase.from('nodes').update({ position: i }).eq('id', n.id)
      })
    )
  }, [markSelfWrite, userId, applyOfflineWrite])

  const insertNode = useCallback(async (parentId, position) => {
    if (!categoryId) return null
    // オフライン時はノード追加不可
    if (!navigator.onLine) return null
    const insertData = {
      user_id: userId, category_id: categoryId,
      title: '新しいノード', content: '', position, is_expanded: true,
    }
    if (parentId !== null && parentId !== undefined) insertData.parent_id = parentId
    const { data, error } = await supabase.from('nodes').insert(insertData).select().single()
    if (error) { console.error('insert error:', error); return null }
    if (data) markSelfWrite(data.id)
    return data
  }, [userId, categoryId, markSelfWrite])

  const addAfter = useCallback(async (targetNode) => {
    if (!targetNode) {
      const roots = nodes.filter(n => n.parent_id === null)
      const maxPos = roots.length > 0 ? Math.max(...roots.map(n => n.position)) : -1
      const data = await insertNode(null, maxPos + 1)
      if (data) { setNodes(prev => prev.some(n => n.id === data.id) ? prev : [...prev, data]); lastSavedContent.current[data.id] = ''; return data }
      return null
    }
    const parentId = targetNode.parent_id ?? null
    const siblings = nodes.filter(n => (n.parent_id ?? null) === parentId).sort((a, b) => a.position - b.position)
    const targetIdx = siblings.findIndex(n => n.id === targetNode.id)
    const data = await insertNode(parentId, siblings.length)
    if (!data) return null
    const newOrder = [...siblings.slice(0, targetIdx + 1), data, ...siblings.slice(targetIdx + 1)]
    setNodes(prev => {
      const without = prev.filter(n => !siblings.some(s => s.id === n.id) && n.id !== data.id)
      return [...without, ...newOrder.map((n, i) => ({ ...n, position: i }))]
    })
    lastSavedContent.current[data.id] = ''
    reorderAndSave(newOrder)
    return data
  }, [nodes, insertNode, reorderAndSave])

  const addBefore = useCallback(async (targetNode) => {
    if (!targetNode) return addAfter(null)
    const parentId = targetNode.parent_id ?? null
    const siblings = nodes.filter(n => (n.parent_id ?? null) === parentId).sort((a, b) => a.position - b.position)
    const targetIdx = siblings.findIndex(n => n.id === targetNode.id)
    const data = await insertNode(parentId, siblings.length)
    if (!data) return null
    const newOrder = [...siblings.slice(0, targetIdx), data, ...siblings.slice(targetIdx)]
    setNodes(prev => {
      const without = prev.filter(n => !siblings.some(s => s.id === n.id) && n.id !== data.id)
      return [...without, ...newOrder.map((n, i) => ({ ...n, position: i }))]
    })
    lastSavedContent.current[data.id] = ''
    reorderAndSave(newOrder)
    return data
  }, [nodes, insertNode, reorderAndSave, addAfter])

  const addChild = useCallback(async (targetNode) => {
    if (!targetNode) return addAfter(null)
    const children = nodes.filter(n => n.parent_id === targetNode.id)
    const maxPos = children.length > 0 ? Math.max(...children.map(n => n.position)) : -1
    if (!targetNode.is_expanded) {
      markSelfWrite(targetNode.id)
      await supabase.from('nodes').update({ is_expanded: true }).eq('id', targetNode.id)
      setNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, is_expanded: true } : n))
    }
    const data = await insertNode(targetNode.id, maxPos + 1)
    if (data) { setNodes(prev => prev.some(n => n.id === data.id) ? prev : [...prev, data]); lastSavedContent.current[data.id] = ''; return data }
    return null
  }, [nodes, insertNode, addAfter, markSelfWrite])

  // ── オンライン復帰時の同期 ─────────────────────────────────
  const syncOfflineChanges = useCallback(async () => {
    if (!userId) return
    const { dirtyNodes, deletedIds } = await getPendingSync(userId)

    // キューが空でも必ず fetchNodes は実行する
    // （IndexedDB 消失後のオフライン起動など、キャッシュがない状態でも
    //  クラウドからデータを復元できるようにするため）
    if (dirtyNodes.length === 0 && deletedIds.length === 0) {
      await fetchNodes()
      return
    }

    console.log(`[OfflineSync] dirty:${dirtyNodes.length} deleted:${deletedIds.length}`)
    try {
      if (deletedIds.length > 0) {
        await supabase.from('nodes').delete().in('id', deletedIds)
      }
      if (dirtyNodes.length > 0) {
        // upsert でオフライン中の insert/update を一括反映
        await supabase.from('nodes').upsert(dirtyNodes, { onConflict: 'id' })
      }
      await clearPendingSync(userId)
      // 権威ある状態を取得し直す
      await fetchNodes()
    } catch (e) {
      console.error('[OfflineSync] failed – will retry on next reconnect:', e)
      // 失敗してもダーティは残しておく（次回再試行）
    }
  }, [userId, fetchNodes])

  // ── 完全削除（確認あり） ──
  const deleteNode = useCallback(async (nodeId) => {
    if (!navigator.onLine) return // オフライン時は削除不可
    const collectIds = (id) => {
      const ids = [id]; nodesRef.current.filter(n => n.parent_id === id).forEach(c => ids.push(...collectIds(c.id))); return ids
    }
    const ids = collectIds(nodeId)
    ids.forEach(id => markSelfWrite(id))
    const { error } = await supabase.from('nodes').delete().in('id', ids)
    if (!error) { setNodes(prev => prev.filter(n => !ids.includes(n.id))); ids.forEach(id => delete lastSavedContent.current[id]) }
  }, [markSelfWrite])

  // ── ごみ箱に移動（元の位置を記憶） ──
  const moveToTrash = useCallback(async (nodeId) => {
    if (!navigator.onLine) return false
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return false
    // ごみ箱ノード自体は移動しない
    if (node.content?.includes(TRASH_NODE_MARKER)) return false

    const trash = await getOrCreateTrashNode()
    if (!trash) return false

    // 元の位置を記憶（content に JSON で保存）
    const originalPosition = {
      parent_id: node.parent_id,
      position: node.position,
    }

    // ごみ箱の子のposition最大値を取得
    const trashChildren = nodes.filter(n => n.parent_id === trash.id)
    const maxPos = trashChildren.length > 0 ? Math.max(...trashChildren.map(n => n.position)) : -1

    // contentに元の位置情報を追記（__ORIGINAL_POS__:{...}__）
    const originalPosTag = `__ORIGINAL_POS__:${JSON.stringify(originalPosition)}__`
    const newContent = (node.content || '') + originalPosTag

    markSelfWrite(nodeId, newContent)
    const { error } = await supabase.from('nodes').update({
      parent_id: trash.id,
      position: maxPos + 1,
      content: newContent,
    }).eq('id', nodeId)

    if (!error) {
      setNodes(prev => prev.map(n => n.id === nodeId
        ? { ...n, parent_id: trash.id, position: maxPos + 1, content: newContent }
        : n
      ))
      lastSavedContent.current[nodeId] = newContent
    }
    return !error
  }, [nodes, getOrCreateTrashNode, markSelfWrite])

  // ── ごみ箱から復元 ──
  const restoreFromTrash = useCallback(async (nodeId) => {
    if (!navigator.onLine) return false
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return false

    // 元の位置情報を取り出す
    const match = (node.content || '').match(/__ORIGINAL_POS__:(.*?)__$/)
    let originalPos = null
    if (match) {
      try { originalPos = JSON.parse(match[1]) } catch {}
    }

    // contentから元位置タグを除去
    const cleanContent = (node.content || '').replace(/__ORIGINAL_POS__:.*?__$/, '')

    // 元の位置に戻す（存在確認）
    const targetParentId = originalPos?.parent_id ?? null
    const targetParent = targetParentId ? nodes.find(n => n.id === targetParentId) : null

    // 元の親が存在しない場合はルートに戻す
    const finalParentId = (targetParentId && targetParent) ? targetParentId : null
    const siblings = nodes.filter(n => (n.parent_id ?? null) === finalParentId && n.id !== nodeId)
    const maxPos = siblings.length > 0 ? Math.max(...siblings.map(n => n.position)) : -1

    markSelfWrite(nodeId, cleanContent)
    const { error } = await supabase.from('nodes').update({
      parent_id: finalParentId,
      position: maxPos + 1,
      content: cleanContent,
    }).eq('id', nodeId)

    if (!error) {
      setNodes(prev => prev.map(n => n.id === nodeId
        ? { ...n, parent_id: finalParentId, position: maxPos + 1, content: cleanContent }
        : n
      ))
      lastSavedContent.current[nodeId] = cleanContent
    }
    return !error
  }, [nodes, markSelfWrite])

  // ── ごみ箱を空にする ──
  const emptyTrash = useCallback(async () => {
    if (!navigator.onLine) return
    const trash = nodes.find(n => n.content?.includes(TRASH_NODE_MARKER))
    if (!trash) return

    const collectIds = (id) => {
      const ids = [id]
      nodes.filter(n => n.parent_id === id).forEach(c => ids.push(...collectIds(c.id)))
      return ids
    }

    // ごみ箱の子ノードを全て削除（ごみ箱自体は残す）
    const trashChildren = nodes.filter(n => n.parent_id === trash.id)
    const idsToDelete = []
    trashChildren.forEach(child => idsToDelete.push(...collectIds(child.id)))

    if (idsToDelete.length === 0) return

    idsToDelete.forEach(id => markSelfWrite(id))
    const { error } = await supabase.from('nodes').delete().in('id', idsToDelete)
    if (!error) {
      setNodes(prev => prev.filter(n => !idsToDelete.includes(n.id)))
      idsToDelete.forEach(id => delete lastSavedContent.current[id])
    }
  }, [nodes, markSelfWrite])

  const updateTitle = useCallback(async (nodeId, title) => {
    markSelfWrite(nodeId)
    const updated = nodesRef.current.map(n => n.id === nodeId ? { ...n, title } : n)
    if (!navigator.onLine) {
      const dirtyNode = updated.find(n => n.id === nodeId)
      await applyOfflineWrite(updated, dirtyNode)
      return
    }
    const { error } = await supabase.from('nodes').update({ title }).eq('id', nodeId)
    if (!error) { setNodes(updated); nodesRef.current = updated }
  }, [markSelfWrite, applyOfflineWrite])

  // ノードのスタイル（装飾）を更新する関数
  const updateNodeStyle = useCallback(async (nodeId, title_style) => {
    markSelfWrite(nodeId)
    const updated = nodesRef.current.map(n => n.id === nodeId ? { ...n, title_style } : n)
    if (!navigator.onLine) {
      const dirtyNode = updated.find(n => n.id === nodeId)
      await applyOfflineWrite(updated, dirtyNode)
      return
    }
    const { error } = await supabase.from('nodes').update({ title_style }).eq('id', nodeId)
    if (!error) { setNodes(updated); nodesRef.current = updated }
  }, [markSelfWrite, applyOfflineWrite])

  const toggleExpanded = useCallback(async (nodeId) => {
    const node = nodesRef.current.find(n => n.id === nodeId); if (!node) return
    const is_expanded = !node.is_expanded
    markSelfWrite(nodeId)
    const updated = nodesRef.current.map(n => n.id === nodeId ? { ...n, is_expanded } : n)
    if (!navigator.onLine) {
      const dirtyNode = updated.find(n => n.id === nodeId)
      await applyOfflineWrite(updated, dirtyNode)
      return
    }
    const { error } = await supabase.from('nodes').update({ is_expanded }).eq('id', nodeId)
    if (!error) { setNodes(updated); nodesRef.current = updated }
  }, [markSelfWrite, applyOfflineWrite])

  const updateContent = useCallback(async (nodeId, content) => {
    if (lastSavedContent.current[nodeId] === content) return
    lastSavedContent.current[nodeId] = content
    markSelfWrite(nodeId, content)
    const updated = nodesRef.current.map(n => n.id === nodeId ? { ...n, content } : n)
    if (!navigator.onLine) {
      const dirtyNode = updated.find(n => n.id === nodeId)
      await applyOfflineWrite(updated, dirtyNode)
      return
    }
    setNodes(updated); nodesRef.current = updated
    await supabase.from('nodes').update({ content }).eq('id', nodeId)
  }, [markSelfWrite, applyOfflineWrite])

  const moveNode = useCallback(async (nodeId, direction) => {
    if (!navigator.onLine) return false
    const node = nodes.find(n => n.id === nodeId); if (!node) return false

    // ごみ箱の移動制限：上下のみ許可、indent/outdentは禁止
    const trashNode = nodes.find(n => n.content?.includes(TRASH_NODE_MARKER))
    if (trashNode) {
      // ごみ箱ノード自体
      if (nodeId === trashNode.id) {
        if (direction === 'indent' || direction === 'outdent') return false
      }
      // ごみ箱の中のノードは移動不可（復元を使う）
      if (node.parent_id === trashNode.id) return false
    }

    const parentId = node.parent_id ?? null
    const siblings = nodes.filter(n => (n.parent_id ?? null) === parentId).sort((a, b) => a.position - b.position)
    const idx = siblings.findIndex(n => n.id === nodeId)
    if (direction === 'up') {
      if (idx <= 0) return false
      const newOrder = [...siblings]; [newOrder[idx-1], newOrder[idx]] = [newOrder[idx], newOrder[idx-1]]
      setNodes(prev => { const rest = prev.filter(n => !siblings.some(s => s.id === n.id)); return [...rest, ...newOrder.map((n,i)=>({...n,position:i}))] })
      reorderAndSave(newOrder); return true
    }
    if (direction === 'down') {
      if (idx >= siblings.length - 1) return false
      const newOrder = [...siblings]; [newOrder[idx], newOrder[idx+1]] = [newOrder[idx+1], newOrder[idx]]
      setNodes(prev => { const rest = prev.filter(n => !siblings.some(s => s.id === n.id)); return [...rest, ...newOrder.map((n,i)=>({...n,position:i}))] })
      reorderAndSave(newOrder); return true
    }
    if (direction === 'outdent') {
      if (parentId === null) return false
      const parent = nodes.find(n => n.id === parentId); if (!parent) return false
      const grandParentId = parent.parent_id ?? null
      const grandSiblings = nodes.filter(n => (n.parent_id ?? null) === grandParentId).sort((a,b) => a.position - b.position)
      const parentIdx = grandSiblings.findIndex(n => n.id === parentId)
      markSelfWrite(nodeId)
      await supabase.from('nodes').update({ parent_id: grandParentId === null ? null : grandParentId, position: grandSiblings.length }).eq('id', nodeId)
      await reorderAndSave([...grandSiblings.slice(0, parentIdx+1), {...node, parent_id: grandParentId}, ...grandSiblings.slice(parentIdx+1)])
      await fetchNodes(); return true
    }
    if (direction === 'indent') {
      if (idx <= 0) return false
      const prevSibling = siblings[idx-1]
      const prevChildren = nodes.filter(n => n.parent_id === prevSibling.id)
      markSelfWrite(nodeId)
      await supabase.from('nodes').update({ parent_id: prevSibling.id, position: prevChildren.length }).eq('id', nodeId)
      if (!prevSibling.is_expanded) { markSelfWrite(prevSibling.id); await supabase.from('nodes').update({ is_expanded: true }).eq('id', prevSibling.id) }
      await fetchNodes(); return true
    }
    return false
  }, [nodes, reorderAndSave, fetchNodes, markSelfWrite])

  const moveNodeTo = useCallback(async (nodeId, targetId, position) => {
    if (!navigator.onLine) return false
    if (nodeId === targetId) return false
    const node = nodes.find(n => n.id === nodeId), target = nodes.find(n => n.id === targetId)
    if (!node || !target) return false

    // ごみ箱ノードを他ノードの子にはできない
    const trashNode = nodes.find(n => n.content?.includes(TRASH_NODE_MARKER))
    if (trashNode) {
      if (nodeId === trashNode.id && position === 'child') return false
      if (nodeId === trashNode.id && target.parent_id !== null) return false
    }

    const isDesc = (cid, aid) => nodes.filter(n => n.parent_id === aid).some(c => c.id === cid || isDesc(cid, c.id))
    if (isDesc(targetId, nodeId)) return false
    markSelfWrite(nodeId)
    if (position === 'child') {
      const children = nodes.filter(n => n.parent_id === targetId)
      await supabase.from('nodes').update({ parent_id: targetId, position: children.length }).eq('id', nodeId)
      if (!target.is_expanded) { markSelfWrite(targetId); await supabase.from('nodes').update({ is_expanded: true }).eq('id', targetId) }
    } else {
      const targetParentId = target.parent_id ?? null
      const targetSiblings = nodes.filter(n => (n.parent_id ?? null) === targetParentId && n.id !== nodeId).sort((a,b) => a.position - b.position)
      const targetIdx = targetSiblings.findIndex(n => n.id === targetId)
      const insertIdx = position === 'before' ? targetIdx : targetIdx + 1
      const newOrder = [...targetSiblings.slice(0, insertIdx), {...node, parent_id: targetParentId}, ...targetSiblings.slice(insertIdx)]
      await supabase.from('nodes').update({ parent_id: targetParentId === null ? null : targetParentId }).eq('id', nodeId)
      await reorderAndSave(newOrder)
    }
    await fetchNodes(); return true
  }, [nodes, reorderAndSave, fetchNodes, markSelfWrite])

  const getLastSelectedId = useCallback(() => {
    if (!userId || !categoryId) return null
    return localStorage.getItem(`namamemo_last_node_${userId}_${categoryId}`) || null
  }, [userId, categoryId])

  // ── カテゴリ間移動（ノード＋全子孫を別カテゴリへ） ──
  const moveToCategoryBranch = useCallback(async (nodeId, targetCategoryId) => {
    if (!userId || !nodeId || !targetCategoryId) return false
    if (targetCategoryId === categoryId) return false

    // 子孫を再帰的に収集
    const collectIds = (id) => {
      const ids = [id]
      nodesRef.current
        .filter(n => n.parent_id === id)
        .forEach(child => ids.push(...collectIds(child.id)))
      return ids
    }
    const allIds = collectIds(nodeId)

    // 移動対象ノードのparent_idをnullにして別カテゴリのルートに配置
    // 移動先カテゴリの最大positionを取得
    const { data: targetNodes } = await supabase
      .from('nodes')
      .select('position')
      .eq('user_id', userId)
      .eq('category_id', targetCategoryId)
      .is('parent_id', null)
      .order('position', { ascending: false })
      .limit(1)

    const maxPos = targetNodes?.[0]?.position ?? -1

    // ルートノードはparent_id=null、position=末尾に
    const { error: rootErr } = await supabase
      .from('nodes')
      .update({ category_id: targetCategoryId, parent_id: null, position: maxPos + 1 })
      .eq('id', nodeId)
      .eq('user_id', userId)
    if (rootErr) { console.error(rootErr); return false }

    // 子孫はcategory_idだけ変更（parent_id・positionはそのまま）
    if (allIds.length > 1) {
      const childIds = allIds.slice(1)
      const { error: childErr } = await supabase
        .from('nodes')
        .update({ category_id: targetCategoryId })
        .in('id', childIds)
        .eq('user_id', userId)
      if (childErr) { console.error(childErr); return false }
    }

    return true
  }, [userId, categoryId])

  const saveLastSelectedId = useCallback((nodeId) => {
    if (!userId || !categoryId) return
    if (nodeId) localStorage.setItem(`namamemo_last_node_${userId}_${categoryId}`, nodeId)
    else localStorage.removeItem(`namamemo_last_node_${userId}_${categoryId}`)
  }, [userId, categoryId])

  return {
    nodes, loading, setNodes,
    addAfter, addBefore, addChild,
    deleteNode, updateTitle, toggleExpanded, updateContent, updateNodeStyle,
    moveNode, moveNodeTo, moveToCategoryBranch,
    moveToTrash, restoreFromTrash, emptyTrash,
    isTrashNode, isInTrash,
    getOrCreateTrashNode,
    getLastSelectedId, saveLastSelectedId,
    fetchNodes, registerExternalUpdateHandler,
    syncOfflineChanges, // オンライン復帰時の同期
  }
}