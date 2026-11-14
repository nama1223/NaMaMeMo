/**
 * useDriveMigration.js
 *
 * Google DriveファイルのアカウントをまたいだマイグレーションをIDIndexedDBで管理。
 * - インポート後に旧DriveIDを持つノードをキューに積む
 * - バックグラウンドで1件ずつ旧Drive→新Driveにコピー
 * - 進捗をIndexedDBに永続化（再起動後も続きから再開）
 * - 中断・再開・スキップに対応
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { getValidDriveToken } from '../utils/driveToken'
import { useDialog } from '../components/DialogProvider'

const DB_NAME = 'namamemo_drive_migration'
const DB_VER  = 1
const QUEUE_STORE = 'queue'

function openMigDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER)
    r.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const s = db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
        s.createIndex('status', 'status')
        s.createIndex('nodeId', 'nodeId')
      }
    }
    r.onsuccess = e => res(e.target.result)
    r.onerror   = e => rej(e.target.error)
  })
}

async function dbGetAll(db, index, value) {
  return new Promise((res, rej) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly')
    const store = tx.objectStore(QUEUE_STORE)
    const req = value !== undefined
      ? store.index(index).getAll(value)
      : store.getAll()
    req.onsuccess = () => res(req.result || [])
    req.onerror   = () => rej(req.error)
  })
}

async function dbPut(db, item) {
  return new Promise((res, rej) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    tx.objectStore(QUEUE_STORE).put(item)
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

async function dbAdd(db, item) {
  return new Promise((res, rej) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    const r = tx.objectStore(QUEUE_STORE).add(item)
    tx.oncomplete = () => res(r.result)
    tx.onerror    = () => rej(tx.error)
  })
}

// HTMLからDriveIDを全部抽出
function extractDriveIds(html) {
  const results = []
  if (!html) return results
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // 画像
  doc.querySelectorAll('img[data-drive-id]').forEach(el => {
    results.push({ driveId: el.getAttribute('data-drive-id'), nodeType: 'image', src: el.getAttribute('src') })
  })
  // 音声
  doc.querySelectorAll('[data-drive-audio][data-drive-id]').forEach(el => {
    results.push({ driveId: el.getAttribute('data-drive-id'), nodeType: 'audio', filename: el.getAttribute('data-filename'), mimeType: el.getAttribute('data-mimetype') })
  })
  // 動画
  doc.querySelectorAll('[data-drive-video][data-drive-id]').forEach(el => {
    results.push({ driveId: el.getAttribute('data-drive-id'), nodeType: 'video', filename: el.getAttribute('data-filename'), thumbSrc: el.getAttribute('data-thumb-src'), mimeType: el.getAttribute('data-mimetype') })
  })
  // PDF
  doc.querySelectorAll('[data-drive-pdf][data-drive-id]').forEach(el => {
    results.push({ driveId: el.getAttribute('data-drive-id'), nodeType: 'pdf', filename: el.getAttribute('data-filename') })
  })
  return results.filter(r => r.driveId)
}

// 旧DriveIDのファイルを新DriveにコピーしてnewDriveIdを返す
async function copyDriveFile(oldDriveId, token, originalFilename) {
  // 1. 旧DriveからメタデータとダウンロードURL取得
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${oldDriveId}?fields=name,mimeType,size`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!metaRes.ok) throw new Error(`メタデータ取得失敗: ${metaRes.status}`)
  const meta = await metaRes.json()
  if (meta.error) throw new Error(meta.error.message)

  // 2. ファイルをダウンロード
  const dlRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${oldDriveId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!dlRes.ok) throw new Error(`ダウンロード失敗: ${dlRes.status}`)
  const blob = await dlRes.blob()

  // 3. NaMaMeMoフォルダを取得/作成
  const FOLDER = 'NaMaMeMo'
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const searchData = await searchRes.json()
  let folderId = searchData.files?.[0]?.id
  if (!folderId) {
    const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' })
    })
    folderId = (await cr.json()).id
  }

  // 4. 新DriveにアップロードResumable
  const filename = originalFilename || meta.name || 'file'
  const mimeType = meta.mimeType || 'application/octet-stream'
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify({ name: filename, parents: [folderId] })
    }
  )
  if (!initRes.ok) throw new Error('Resumable upload初期化失敗: ' + initRes.status)
  const uploadUrl = initRes.headers.get('Location')

  const newFileId = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', mimeType)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).id) }
        catch { reject(new Error('レスポンス解析失敗')) }
      } else { reject(new Error('アップロード失敗: ' + xhr.status)) }
    }
    xhr.onerror = () => reject(new Error('ネットワークエラー'))
    xhr.send(blob)
  })

  // 5. 権限設定
  await fetch(`https://www.googleapis.com/drive/v3/files/${newFileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' })
  })

  return { newFileId, mimeType }
}

// ノードのHTMLコンテンツ内のdriveIdを新しいものに置換
function replacedriveIdInHtml(html, oldId, newId) {
  if (!html) return html
  return html
    .replace(new RegExp(`data-drive-id="${oldId}"`, 'g'), `data-drive-id="${newId}"`)
    .replace(new RegExp(`/d/${oldId}/`, 'g'), `/d/${newId}/`)
    .replace(new RegExp(`id=${oldId}`, 'g'), `id=${newId}`)
}

export function useDriveMigration(userId, settings, updateSettings) {
  const { toast, banner } = useDialog()
  const [queue, setQueue]       = useState([])   // 全キュー
  const [running, setRunning]   = useState(false)
  const [current, setCurrent]   = useState(null) // 現在処理中のアイテム
  const [stats, setStats]       = useState({ total: 0, done: 0, failed: 0 })
  const abortRef                = useRef(false)
  const dbRef                   = useRef(null)

  // DB初期化＋起動時に未完了キューを読み込み
  useEffect(() => {
    openMigDB().then(async db => {
      dbRef.current = db
      const pending = await dbGetAll(db, 'status', 'pending')
      const failed  = await dbGetAll(db, 'status', 'failed')
      const all = [...pending, ...failed]
      if (all.length > 0) {
        setQueue(all)
        const total = (await dbGetAll(db)).length
        const done  = (await dbGetAll(db, 'status', 'done')).length
        setStats({ total, done, failed: failed.length })
      }
    }).catch(console.warn)
  }, [])

  // キューに追加（インポート後に呼ぶ）
  const enqueueNodes = useCallback(async (importedNodes) => {
    const db = dbRef.current
    if (!db) return
    let count = 0
    for (const node of importedNodes) {
      const items = extractDriveIds(node.content)
      for (const item of items) {
        await dbAdd(db, {
          status: 'pending',
          nodeId: node.id,
          driveId: item.driveId,
          nodeType: item.nodeType,
          filename: item.filename || '',
          mimeType: item.mimeType || '',
          retries: 0,
          enqueuedAt: Date.now(),
        })
        count++
      }
    }
    if (count > 0) {
      const all = await dbGetAll(db)
      const done = (await dbGetAll(db, 'status', 'done')).length
      const failed = (await dbGetAll(db, 'status', 'failed')).length
      setQueue(await dbGetAll(db, 'status', 'pending'))
      setStats({ total: all.length, done, failed })
    }
    return count
  }, [])

  // 移設実行
  const startMigration = useCallback(async () => {
    const db = dbRef.current
    if (!db || running) return
    if (!settings?.useGoogleDrive || !settings?.googleDriveToken) {
      banner('Google Drive連携が必要です。設定から連携してください。')
      return
    }
    abortRef.current = false
    setRunning(true)

    try {
      while (!abortRef.current) {
        const pending = await dbGetAll(db, 'status', 'pending')
        if (pending.length === 0) break

        const item = pending[0]
        setCurrent(item)

        try {
          const token = await getValidDriveToken(settings)
          if (!token) throw new Error('Drive認証失敗')

          // ファイルをコピー
          const { newFileId } = await copyDriveFile(item.driveId, token, item.filename)

          // ノードのHTMLを更新
          const { data: nodeData } = await supabase
            .from('nodes').select('content').eq('id', item.nodeId).single()
          if (nodeData?.content) {
            const newContent = replacedriveIdInHtml(nodeData.content, item.driveId, newFileId)
            await supabase.from('nodes').update({ content: newContent }).eq('id', item.nodeId)
          }

          // キューを完了に
          await dbPut(db, { ...item, status: 'done', newDriveId: newFileId, doneAt: Date.now() })
          const all = await dbGetAll(db)
          const done = (await dbGetAll(db, 'status', 'done')).length
          const failed = (await dbGetAll(db, 'status', 'failed')).length
          setStats({ total: all.length, done, failed })

        } catch (err) {
          console.warn('移設失敗:', err)
          await dbPut(db, { ...item, status: item.retries >= 2 ? 'failed' : 'pending', retries: (item.retries || 0) + 1, lastError: err.message })
          if (item.retries >= 2) {
            const failed = (await dbGetAll(db, 'status', 'failed')).length
            setStats(s => ({ ...s, failed }))
          }
          // 失敗時は少し待つ
          await new Promise(r => setTimeout(r, 2000))
        }

        setCurrent(null)
        // 次のアイテムの前に少し待つ（API制限対策）
        await new Promise(r => setTimeout(r, 800))
      }
    } finally {
      setRunning(false)
      setCurrent(null)
      const pending = await dbGetAll(db, 'status', 'pending')
      setQueue(pending)
    }
  }, [running, settings, toast, banner])

  const stopMigration = useCallback(() => {
    abortRef.current = true
  }, [])

  // 失敗分を再試行に戻す
  const retryFailed = useCallback(async () => {
    const db = dbRef.current
    if (!db) return
    const failed = await dbGetAll(db, 'status', 'failed')
    for (const item of failed) {
      await dbPut(db, { ...item, status: 'pending', retries: 0 })
    }
    const pending = await dbGetAll(db, 'status', 'pending')
    setQueue(pending)
    setStats(s => ({ ...s, failed: 0 }))
  }, [])

  // キューをクリア（完了済みのみ削除）
  const clearCompleted = useCallback(async () => {
    const db = dbRef.current
    if (!db) return
    const done = await dbGetAll(db, 'status', 'done')
    for (const item of done) {
      await new Promise((res, rej) => {
        const tx = db.transaction(QUEUE_STORE, 'readwrite')
        tx.objectStore(QUEUE_STORE).delete(item.id)
        tx.oncomplete = res; tx.onerror = rej
      })
    }
    const all = await dbGetAll(db)
    setStats(s => ({ ...s, total: all.length, done: 0 }))
  }, [])

  const pendingCount = stats.total - stats.done - stats.failed
  const hasWork = pendingCount > 0 || stats.failed > 0

  return {
    queue, running, current, stats, hasWork, pendingCount,
    enqueueNodes, startMigration, stopMigration, retryFailed, clearCompleted,
  }
}
