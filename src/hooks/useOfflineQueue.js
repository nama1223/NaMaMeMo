/**
 * useOfflineQueue.js
 *
 * オフライン中のSupabase書き込みをIndexedDBにキューイングし、
 * オンラインに戻ったときに自動送信する。
 *
 * 使い方：
 *   useNodesのupdateContent等に割り込んで、
 *   オフライン時はSupabaseを直接叩かずキューに積む。
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'

const DB_NAME    = 'namamemo_offline'
const DB_VERSION = 1
const STORE_NAME = 'write_queue'

// ── IndexedDB ユーティリティ ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function enqueue(operation) {
  const db    = await openDB()
  const tx    = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  store.add({ ...operation, enqueuedAt: Date.now() })
  return new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

async function dequeueAll() {
  const db    = await openDB()
  const tx    = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  const items = await new Promise((res, rej) => {
    const req = store.getAll()
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
  store.clear()
  return items
}

async function getQueueCount() {
  const db    = await openDB()
  const tx    = db.transaction(STORE_NAME, 'readonly')
  const store = tx.objectStore(STORE_NAME)
  return new Promise((res, rej) => {
    const req = store.count()
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

export function useOfflineQueue(isOnline) {
  const [queueCount, setQueueCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const syncingRef = useRef(false)

  // 起動時にキュー件数を確認
  useEffect(() => {
    getQueueCount().then(setQueueCount).catch(() => {})
  }, [])

  // ── オンラインに戻ったら同期 ──
  const syncQueue = useCallback(async () => {
    if (syncingRef.current) return
    const count = await getQueueCount()
    if (count === 0) return

    syncingRef.current = true
    setSyncing(true)

    try {
      const items = await dequeueAll()
      let successCount = 0

      for (const item of items) {
        try {
          if (item.type === 'UPDATE_CONTENT') {
            const { error } = await supabase
              .from('nodes')
              .update({ content: item.content })
              .eq('id', item.nodeId)
            if (!error) successCount++
          } else if (item.type === 'UPDATE_TITLE') {
            const { error } = await supabase
              .from('nodes')
              .update({ title: item.title })
              .eq('id', item.nodeId)
            if (!error) successCount++
          } else if (item.type === 'UPDATE_STYLE') {
            const { error } = await supabase
              .from('nodes')
              .update({ title_style: item.title_style })
              .eq('id', item.nodeId)
            if (!error) successCount++
          }
          // 他のオペレーションも必要に応じて追加
        } catch (err) {
          console.warn('オフラインキュー送信失敗:', err)
          // 失敗分は再エンキュー
          await enqueue(item).catch(() => {})
        }
      }

      setQueueCount(0)
      setLastSyncAt(new Date())
      console.log(`オフラインキュー同期完了: ${successCount}件`)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    if (isOnline) {
      syncQueue()
    }
  }, [isOnline, syncQueue])

  // ── オフライン書き込みをキューに積む ──
  const queueWrite = useCallback(async (operation) => {
    await enqueue(operation)
    const count = await getQueueCount()
    setQueueCount(count)
  }, [])

  return {
    queueCount,
    syncing,
    lastSyncAt,
    syncQueue,
    queueWrite,
  }
}
