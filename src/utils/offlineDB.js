/**
 * offlineDB.js
 * IndexedDB を使ったオフライン用キャッシュ・ダーティキュー管理
 *
 * ストア構造（単一 "cache" ストアにキー/値で保存）:
 *   nodes_{userId}_{categoryId}   → nodes[] (読み取りキャッシュ)
 *   categories_{userId}           → categories[] (読み取りキャッシュ)
 *   dirty_{userId}                → { [nodeId]: nodeData } (書き込み待ちノード)
 *   deleted_{userId}              → nodeId[] (削除待ちノード)
 */

const DB_NAME = 'namamemo_offline_v1'
const DB_VERSION = 1
let _db = null

async function openDB() {
  if (_db) return _db
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' })
      }
    }
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key) {
  try {
    const db = await openDB()
    return await new Promise((resolve) => {
      const tx = db.transaction('cache', 'readonly')
      const req = tx.objectStore('cache').get(key)
      req.onsuccess = () => resolve(req.result?.value ?? null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

async function idbSet(key, value) {
  try {
    const db = await openDB()
    await new Promise((resolve) => {
      const tx = db.transaction('cache', 'readwrite')
      tx.objectStore('cache').put({ key, value })
      tx.oncomplete = resolve
      tx.onerror = resolve
    })
  } catch {}
}

// ─── Nodes キャッシュ ─────────────────────────────────────────
export async function cacheNodes(userId, categoryId, nodes) {
  await idbSet(`nodes_${userId}_${categoryId}`, nodes)
}

export async function getCachedNodes(userId, categoryId) {
  return await idbGet(`nodes_${userId}_${categoryId}`)
}

// ─── Categories キャッシュ ────────────────────────────────────
export async function cacheCategories(userId, categories) {
  await idbSet(`categories_${userId}`, categories)
}

export async function getCachedCategories(userId) {
  return await idbGet(`categories_${userId}`)
}

// ─── ダーティ管理（オフライン書き込みキュー）─────────────────
// キーはユーザーID単位（複数カテゴリをまとめて管理）

export async function markNodeDirty(userId, node) {
  const key = `dirty_${userId}`
  const existing = (await idbGet(key)) || {}
  existing[node.id] = { ...node }
  await idbSet(key, existing)
}

export async function markNodeDeleted(userId, nodeId) {
  // 削除リストに追加
  const delKey = `deleted_${userId}`
  const existing = (await idbGet(delKey)) || []
  if (!existing.includes(nodeId)) existing.push(nodeId)
  await idbSet(delKey, existing)
  // ダーティリストから除外（削除優先）
  const dirtyKey = `dirty_${userId}`
  const dirty = (await idbGet(dirtyKey)) || {}
  if (dirty[nodeId]) { delete dirty[nodeId]; await idbSet(dirtyKey, dirty) }
}

export async function getPendingSync(userId) {
  const dirty = (await idbGet(`dirty_${userId}`)) || {}
  const deleted = (await idbGet(`deleted_${userId}`)) || []
  return { dirtyNodes: Object.values(dirty), deletedIds: deleted }
}

export async function clearPendingSync(userId) {
  await idbSet(`dirty_${userId}`, {})
  await idbSet(`deleted_${userId}`, [])
}

export async function hasPendingSync(userId) {
  const { dirtyNodes, deletedIds } = await getPendingSync(userId)
  return dirtyNodes.length > 0 || deletedIds.length > 0
}
