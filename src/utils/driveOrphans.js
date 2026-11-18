/**
 * driveOrphans.js
 *
 * Google Drive 上の添付ファイルのうち、どのメモからも参照されていない
 * 「残りっぱなしのファイル」を検出・削除するためのユーティリティ。
 *
 * 参照モデル:
 * - 添付（画像・音声・動画・PDF）は貼り付け時に Drive へ保存され、
 *   メモ本文（nodes.content の HTML）の data-drive-id 属性でのみ参照される。
 * - テキスト添付は本文内に埋め込まれるため Drive には存在しない。
 * - node_backups の本文スナップショットも参照として数える
 *   （バックアップ復元時に添付が壊れないようにするため）。
 */
import { supabase } from '../supabaseClient'
import { getValidDriveToken } from './driveToken'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// 本文HTMLから Drive ファイルIDを全て取り出す
export function extractDriveIds(html) {
  const ids = new Set()
  if (!html) return ids
  const re = /data-drive-id=["']([^"']+)["']/g
  let m
  while ((m = re.exec(html)) !== null) {
    if (m[1]) ids.add(m[1])
  }
  return ids
}

// 指定テーブルにある自分の行の content を全件取得（1000件ずつページング）
async function fetchAllContents(table, userId) {
  const contents = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('content')
      .eq('user_id', userId)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data || []
    rows.forEach(r => { if (r.content) contents.push(r.content) })
    if (rows.length < PAGE) break
  }
  return contents
}

// Drive 上の自アプリのファイルを全件取得（フォルダ自体は除く）
// drive.file 権限のため、返ってくるのはこのアプリが作ったファイルだけ
async function listDriveFiles(token) {
  const files = []
  let pageToken = null
  do {
    const params = new URLSearchParams({
      q: 'trashed = false',
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime)',
      pageSize: '1000',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Driveのファイル一覧の取得に失敗しました (${res.status})`)
    const data = await res.json()
    ;(data.files || []).forEach(f => {
      if (f.mimeType !== FOLDER_MIME) files.push(f)
    })
    pageToken = data.nextPageToken || null
  } while (pageToken)
  return files
}

/**
 * 残りっぱなしファイルのスキャン
 * @returns {{ orphans: Array<{id,name,mimeType,size,createdTime,inBackupOnly}>, totalFiles: number, referencedCount: number }}
 *   orphans: どのメモからも参照されていないファイル。
 *   inBackupOnly が true のものは、バックアップの中にだけ参照が残っている。
 */
export async function scanDriveOrphans(userId, token) {
  const [nodeContents, backupContents, driveFiles] = await Promise.all([
    fetchAllContents('nodes', userId),
    fetchAllContents('node_backups', userId),
    listDriveFiles(token),
  ])
  const referenced = new Set()
  nodeContents.forEach(c => extractDriveIds(c).forEach(id => referenced.add(id)))
  const backupOnly = new Set()
  backupContents.forEach(c => extractDriveIds(c).forEach(id => {
    if (!referenced.has(id)) backupOnly.add(id)
  }))

  const orphans = driveFiles
    .filter(f => !referenced.has(f.id))
    .map(f => ({
      id: f.id,
      name: f.name || '(名前なし)',
      mimeType: f.mimeType || '',
      size: f.size != null ? Number(f.size) : null,
      createdTime: f.createdTime || null,
      inBackupOnly: backupOnly.has(f.id),
    }))
    .sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''))
  return { orphans, totalFiles: driveFiles.length, referencedCount: referenced.size }
}

// Drive ファイルを完全削除（既に無い場合は成功扱い）
export async function deleteDriveFile(token, fileId) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.ok || res.status === 404
}

// トークン取得（再連携待ちで固まらないようタイムアウト付き）
export async function getDriveTokenWithTimeout(settings, timeoutMs = 20000) {
  let timer = null
  try {
    return await Promise.race([
      getValidDriveToken(settings || {}),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * ノード完全削除時の後片付け。
 * 削除されたノード群の本文にあった添付のうち、残っている全ノードと
 * バックアップのどちらからも参照されていないものだけを Drive から消す。
 * （複製で複数ノードから参照されているファイルは消えない）
 * 呼び出し側の本処理（ノード削除）には一切影響させない。
 *
 * @param {string} userId
 * @param {object} settings - useSettings の設定オブジェクト
 * @param {string[]} deletedContents - 削除されたノードの本文HTML
 * @param {string[]} localSurvivingContents - 画面表示中のカテゴリで残っているノードの本文HTML（DB取得分と合わせて二重に確認する）
 */
export async function cleanupDriveFilesAfterNodeDelete(userId, settings, deletedContents, localSurvivingContents = []) {
  try {
    const candidates = new Set()
    ;(deletedContents || []).forEach(c => extractDriveIds(c).forEach(id => candidates.add(id)))
    if (candidates.size === 0) return

    const [nodeContents, backupContents] = await Promise.all([
      fetchAllContents('nodes', userId),
      fetchAllContents('node_backups', userId),
    ])
    const referenced = new Set()
    nodeContents.forEach(c => extractDriveIds(c).forEach(id => referenced.add(id)))
    backupContents.forEach(c => extractDriveIds(c).forEach(id => referenced.add(id)))
    ;(localSurvivingContents || []).forEach(c => extractDriveIds(c).forEach(id => referenced.add(id)))

    const targets = [...candidates].filter(id => !referenced.has(id))
    if (targets.length === 0) return

    const token = await getDriveTokenWithTimeout(settings, 10000)
    if (!token) {
      console.info('[DriveCleanup] トークンが取得できないため、添付の後片付けをスキップしました')
      return
    }
    let deleted = 0
    for (const id of targets) {
      try { if (await deleteDriveFile(token, id)) deleted++ } catch (e) { console.warn('[DriveCleanup] ファイル削除に失敗:', id, e) }
    }
    console.info(`[DriveCleanup] 残りっぱなしの添付ファイルを ${deleted} 件削除しました`)
  } catch (e) {
    console.warn('[DriveCleanup] 後片付けに失敗しました（ノード削除自体は完了しています）:', e)
  }
}
