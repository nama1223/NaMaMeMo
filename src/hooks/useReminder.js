/**
 * useReminder.js
 *
 * プッシュ通知（Web Push）を使ったリマインダー機能。
 * - Notification API で通知許可を取得
 * - 指定日時になったら通知を送る
 * - IndexedDB でリマインダーを永続化
 * - Service Worker の Background Sync / setTimeout の両方に対応
 *
 * ★ VAPID公開鍵について：
 *    本番環境では Supabase Edge Function や自前サーバーで
 *    Web Push の購読・送信を行う必要があります。
 *    このフックは「ローカル通知（Notification API直接）」を使います。
 *    バックグラウンドのプッシュは Service Worker から行います。
 */
import { useState, useEffect, useCallback, useRef } from 'react'

const DB_NAME    = 'namamemo_reminders'
const DB_VERSION = 1
const STORE_NAME = 'reminders'

// ── IndexedDB ──
function openReminderDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('nodeId', 'nodeId', { unique: false })
        store.createIndex('scheduledAt', 'scheduledAt', { unique: false })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function saveReminder(reminder) {
  const db    = await openReminderDB()
  const tx    = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  store.put(reminder)
  return new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

async function deleteReminderFromDB(id) {
  const db    = await openReminderDB()
  const tx    = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  store.delete(id)
  return new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
  })
}

async function getAllReminders() {
  const db    = await openReminderDB()
  const tx    = db.transaction(STORE_NAME, 'readonly')
  const store = tx.objectStore(STORE_NAME)
  return new Promise((res, rej) => {
    const req = store.getAll()
    req.onsuccess = () => res(req.result || [])
    req.onerror   = () => rej(req.error)
  })
}

export function useReminder() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  )
  const [reminders, setReminders] = useState([])
  const timersRef = useRef({}) // { [reminderId]: timeoutId }

  // 起動時にリマインダーを読み込み、タイマーをセット
  useEffect(() => {
    loadAndScheduleAll()
    return () => {
      // クリーンアップ：全タイマーを解除
      Object.values(timersRef.current).forEach(clearTimeout)
    }
  }, [])

  const loadAndScheduleAll = async () => {
    try {
      const all = await getAllReminders()
      const now = Date.now()
      // 過去のものは除外してUIを更新
      const future = all.filter(r => r.scheduledAt > now)
      setReminders(future)
      // それぞれタイマーをセット
      future.forEach(r => scheduleTimer(r))
      // 過去のものはDBからも削除
      const past = all.filter(r => r.scheduledAt <= now)
      past.forEach(r => deleteReminderFromDB(r.id))
    } catch (err) {
      console.warn('リマインダー読み込み失敗:', err)
    }
  }

  // ── 通知許可を求める ──
  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'unsupported'
    const result = await Notification.requestPermission()
    setPermission(result)
    return result
  }, [])

  // ── タイマーをセット（アプリが開いている間有効）──
  const scheduleTimer = useCallback((reminder) => {
    const delay = reminder.scheduledAt - Date.now()
    if (delay <= 0) return

    // 既存タイマーをクリア
    if (timersRef.current[reminder.id]) {
      clearTimeout(timersRef.current[reminder.id])
    }

    timersRef.current[reminder.id] = setTimeout(async () => {
      // 通知を表示
      if (Notification.permission === 'granted') {
        // SWが利用可能ならSW経由で（バックグラウンドでも動く）
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: `📝 ${reminder.nodeTitle}`,
            body: reminder.message || 'リマインダーの時間です',
            data: { nodeId: reminder.nodeId },
          })
        } else {
          // フォールバック：直接Notification
          new Notification(`📝 ${reminder.nodeTitle}`, {
            body: reminder.message || 'リマインダーの時間です',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `reminder-${reminder.id}`,
          })
        }
      }
      // リマインダーを削除
      await deleteReminderFromDB(reminder.id)
      setReminders(prev => prev.filter(r => r.id !== reminder.id))
      delete timersRef.current[reminder.id]
    }, delay)
  }, [])

  // ── リマインダーを追加 ──
  const addReminder = useCallback(async ({
    nodeId,
    nodeTitle,
    scheduledAt, // timestamp (ms)
    message = '',
  }) => {
    if (permission !== 'granted') {
      const result = await requestPermission()
      if (result !== 'granted') {
        alert('通知の許可が必要です。ブラウザの設定から通知を許可してください。')
        return null
      }
    }

    const reminder = {
      id:          `reminder_${nodeId}_${Date.now()}`,
      nodeId,
      nodeTitle,
      scheduledAt,
      message,
      createdAt:   Date.now(),
    }

    await saveReminder(reminder)
    scheduleTimer(reminder)
    setReminders(prev => [...prev.filter(r => r.nodeId !== nodeId), reminder])

    return reminder
  }, [permission, requestPermission, scheduleTimer])

  // ── リマインダーを削除 ──
  const removeReminder = useCallback(async (reminderId) => {
    clearTimeout(timersRef.current[reminderId])
    delete timersRef.current[reminderId]
    await deleteReminderFromDB(reminderId)
    setReminders(prev => prev.filter(r => r.id !== reminderId))
  }, [])

  // ── ノードのリマインダーを取得 ──
  const getReminderForNode = useCallback((nodeId) => {
    return reminders.find(r => r.nodeId === nodeId) || null
  }, [reminders])

  return {
    permission,
    reminders,
    requestPermission,
    addReminder,
    removeReminder,
    getReminderForNode,
    isSupported: typeof Notification !== 'undefined',
  }
}
