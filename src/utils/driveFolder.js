// Google Drive のアプリ用フォルダ（NamaStudio/NaMaMeMo）の取得・作成・移行を共通化する。
// 仕様:
// - NaMaMeMo フォルダは名前で検索する（場所は問わない）。見つかればそのまま使う。
// - アプリから見える NamaStudio フォルダがあり、NaMaMeMo がその配下に無ければ、
//   配下へ付け替える（自動移行・失敗してもアップロードは止めない）。
// - NaMaMeMo が無ければ、NamaStudio（無ければルートに作成）の配下に新規作成する。
// - NamaStudio まわりの処理が失敗した場合は、従来どおりルートへの作成にフォールバックする。

const STUDIO_NAME = 'NamaStudio'
const FOLDER_NAME = 'NaMaMeMo'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

async function searchFolder(token, name) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false&fields=files(id,parents)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.files?.[0] || null
}

async function createFolder(token, name, parents) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, mimeType: FOLDER_MIME,
      ...(parents?.length ? { parents } : {}),
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data
}

// NaMaMeMo フォルダの ID を返す。無ければ NamaStudio 配下に作成する。
export async function getOrCreateAppFolder(token) {
  const folder = await searchFolder(token, FOLDER_NAME)
  if (folder) {
    // 自動移行: アプリから見える NamaStudio があり、まだその配下でなければ付け替える。
    // 手動で作られた NamaStudio はアプリの権限では見えないため、その場合は何もしない
    // （ ＝ 手動で整理済みの配置を壊さない）。
    try {
      const studio = await searchFolder(token, STUDIO_NAME)
      if (studio && !(folder.parents || []).includes(studio.id)) {
        const qs = new URLSearchParams({ addParents: studio.id })
        if (folder.parents?.length) qs.set('removeParents', folder.parents.join(','))
        await fetch(`https://www.googleapis.com/drive/v3/files/${folder.id}?${qs}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      }
    } catch {
      // 移行に失敗してもアップロード自体は続行する
    }
    return folder.id
  }

  // 新規作成: NamaStudio 配下に入れる。NamaStudio の用意に失敗したらルートに作る。
  let parents = null
  try {
    const studio = (await searchFolder(token, STUDIO_NAME)) || (await createFolder(token, STUDIO_NAME))
    parents = [studio.id]
  } catch {
    parents = null
  }
  const created = await createFolder(token, FOLDER_NAME, parents)
  return created.id
}
