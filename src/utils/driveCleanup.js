// アカウント削除時の Google Drive 後片付け。
// NaMaMeMo フォルダの中身とフォルダ自体を削除し、親の NamaStudio フォルダは
// 中が空になった場合に限って削除する（プライバシーポリシー第5章の記載どおり）。
// フォルダが無い場合は何もしない（作成は絶対にしない）。

const STUDIO_NAME = 'NamaStudio'
const FOLDER_NAME = 'NaMaMeMo'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const API = 'https://www.googleapis.com/drive/v3/files'

async function driveJson(token, url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) throw new Error(data?.error?.message || `Drive API error (${res.status})`)
  return data
}

async function searchFolder(token, name) {
  const data = await driveJson(token, `${API}?q=name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false&fields=files(id,parents)`)
  return data?.files?.[0] || null
}

async function listChildren(token, folderId) {
  const files = []
  let pageToken = null
  do {
    const qs = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType)',
      pageSize: '100',
    })
    if (pageToken) qs.set('pageToken', pageToken)
    const data = await driveJson(token, `${API}?${qs}`)
    files.push(...(data?.files || []))
    pageToken = data?.nextPageToken || null
  } while (pageToken)
  return files
}

async function deleteOne(token, id) {
  await driveJson(token, `${API}/${id}`, { method: 'DELETE' })
}

// フォルダの中身を再帰的に削除し、削除したファイル数を返す（フォルダ自体は消さない）
async function deleteChildrenRecursive(token, folderId) {
  let count = 0
  const children = await listChildren(token, folderId)
  for (const child of children) {
    if (child.mimeType === FOLDER_MIME) {
      count += await deleteChildrenRecursive(token, child.id)
      await deleteOne(token, child.id)
    } else {
      await deleteOne(token, child.id)
      count++
    }
  }
  return count
}

// 戻り値: { folderFound, filesDeleted, folderDeleted, studioDeleted }
export async function cleanupDriveData(token) {
  const result = { folderFound: false, filesDeleted: 0, folderDeleted: false, studioDeleted: false }
  const folder = await searchFolder(token, FOLDER_NAME)
  if (!folder) return result
  result.folderFound = true
  result.filesDeleted = await deleteChildrenRecursive(token, folder.id)
  await deleteOne(token, folder.id)
  result.folderDeleted = true

  // 親フォルダは、中に何も残っていないことが確認できた場合に限り削除する。
  // drive.file の権限で見えない他アプリのフォルダがある場合はそもそも見えないため、
  // 「見える範囲で空」のときだけ削除する（ポリシーの記載どおりの挙動）。
  try {
    const studio = await searchFolder(token, STUDIO_NAME)
    if (studio) {
      const rest = await listChildren(token, studio.id)
      if (rest.length === 0) {
        await deleteOne(token, studio.id)
        result.studioDeleted = true
      }
    }
  } catch {
    // 親フォルダの確認・削除に失敗しても、アカウント削除自体は続行する
  }
  return result
}
