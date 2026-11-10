/**
 * ShareModal.jsx v2
 */
import { useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { getValidDriveToken } from '../utils/driveToken'


function extractVideoThumb(blob) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'; video.muted = true; video.playsInline = true
    const url = URL.createObjectURL(blob)
    video.src = url
    video.onloadeddata = () => { video.currentTime = 1 }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      const ratio = Math.min(1, 320 / (video.videoWidth || 320))
      canvas.width = Math.round((video.videoWidth||320) * ratio)
      canvas.height = Math.round((video.videoHeight||180) * ratio)
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(b => resolve(b), 'image/jpeg', 0.7)
    }
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
  })
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

async function uploadToDrive(file, token, onProgress) {
  const FOLDER = 'NaMaMeMo'
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const sd = await searchRes.json()
  if (sd.error) throw new Error(sd.error.message)
  let folderId = sd.files?.[0]?.id
  if (!folderId) {
    const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' })
    })
    folderId = (await cr.json()).id
  }
  const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'X-Upload-Content-Type': file.type, 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ name: file.name, parents: [folderId] })
  })
  if (!initRes.ok) throw new Error('Resumable upload失敗: ' + initRes.status)
  const uploadUrl = initRes.headers.get('Location')
  const fileId = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(Math.round(e.loaded/e.total*100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText).id) } catch { reject(new Error('parse失敗')) } }
      else reject(new Error('失敗: ' + xhr.status))
    }
    xhr.onerror = () => reject(new Error('ネットワークエラー'))
    xhr.send(file)
  })
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' })
  })
  return fileId
}

function compressBlob(blob, maxWidth=1280, quality=0.75) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const ratio = Math.min(1, maxWidth/img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width*ratio); canvas.height = Math.round(img.height*ratio)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(resolve, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob) }
    img.src = url
  })
}


export default function ShareModal({ data, nodes, userId, settings, onClose, onInsert }) {
  const [search, setSearch] = useState('')
  const [inserting, setInserting] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [selectedFiles, setSelectedFiles] = useState((data.files||[]).map(f=>({...f,selected:true})))

  const { title='', text='', url='' } = data
  const hasText = title||text||url

  const buildTree = useCallback(() => {
    const trash = new Set(nodes.filter(n=>n.content?.includes('__TRASH__')).map(n=>n.id))
    const result = []
    const visit = (pid, depth) => {
      nodes.filter(n=>(n.parent_id||null)===pid && !trash.has(n.id))
        .sort((a,b)=>(a.position||0)-(b.position||0))
        .forEach(n => { result.push({...n,_depth:Math.min(depth,5)}); visit(n.id,depth+1) })
    }
    visit(null, 0); return result
  }, [nodes])

  const treeNodes = buildTree()
  const filtered = search ? treeNodes.filter(n=>(n.title||'').toLowerCase().includes(search.toLowerCase())) : treeNodes

  const handleInsert = async (nodeId) => {
    setInserting(true)
    setProgressMsg('⏳ 処理を開始しています…')
    try {
      setProgressMsg('🔑 Google Drive認証を確認中…')
      let token = await getValidDriveToken(settings)

      let html = ''
      if (title) html += `<p><strong>${escHtml(title)}</strong></p>`
      if (text)  html += `<p>${escHtml(text).replace(/\n/g,'<br>')}</p>`
      if (url)   html += `<p><a href="${escHtml(url)}">${escHtml(url)}</a></p>`

      const active = selectedFiles.filter(f=>f.selected)
      for (let i=0; i<active.length; i++) {
        const f = active[i], pre = active.length>1 ? `[${i+1}/${active.length}] ` : ''
        if (f.type?.startsWith('image/')) {
          setProgressMsg(`${pre}🖼 画像を圧縮中…`)
          const thumb = await compressBlob(f.blob)
          const path = `${userId}/share_${Date.now()}_${i}.jpg`
          const {error} = await supabase.storage.from('images').upload(path, thumb, {contentType:'image/jpeg'})
          let thumbUrl = null
          if (!error) { const {data:d} = supabase.storage.from('images').getPublicUrl(path); thumbUrl = d.publicUrl }
          if (token) {
            setProgressMsg(`${pre}🖼 DriveにアップロードP中…`)
            const driveId = await uploadToDrive(new File([f.blob],f.name,{type:f.type}), token, pct=>setProgressMsg(`${pre}🖼 アップロード中… ${pct}%`))
            html += `<img src="${thumbUrl||''}" data-drive-id="${driveId}" />`
          } else {
            html += thumbUrl ? `<img src="${thumbUrl}" />` : ''
          }
        } else if (f.type?.startsWith('audio/')) {
          if (!token) { html += `<p>🎵 ${escHtml(f.name)}（Drive未連携のためスキップ）</p>`; continue }
          setProgressMsg(`${pre}🎵 音声をアップロード中…`)
          const driveId = await uploadToDrive(new File([f.blob],f.name,{type:f.type}), token, pct=>setProgressMsg(`${pre}🎵 ${pct}%`))
          html += `<div data-drive-audio="" data-drive-id="${driveId}" data-filename="${escHtml(f.name)}" data-mimetype="${f.type}"></div>`
        } else if (f.type?.startsWith('video/')) {
          if (!token) { html += `<p>🎬 ${escHtml(f.name)}（Drive未連携のためスキップ）</p>`; continue }
          // サムネイル抽出
          setProgressMsg(`${pre}🎬 動画のサムネイルを抽出中…`)
          let thumbUrl = ''
          try {
            const thumbBlob = await extractVideoThumb(f.blob)
            if (thumbBlob && userId) {
              const tpath = `${userId}/share_vthumb_${Date.now()}_${i}.jpg`
              const {error:te} = await supabase.storage.from('images').upload(tpath, thumbBlob, {contentType:'image/jpeg'})
              if (!te) { const {data:td} = supabase.storage.from('images').getPublicUrl(tpath); thumbUrl = td.publicUrl }
            }
          } catch(e) { console.warn('動画サムネイル失敗:', e) }
          setProgressMsg(`${pre}🎬 動画をアップロード中…`)
          const driveId = await uploadToDrive(new File([f.blob],f.name,{type:f.type}), token, pct=>setProgressMsg(`${pre}🎬 ${pct}%`))
          html += `<div data-drive-video="" data-drive-id="${driveId}" data-filename="${escHtml(f.name)}" data-thumb-src="${thumbUrl}" data-mimetype="${f.type}"></div>`
        } else if (f.type === 'application/pdf' || f.name?.toLowerCase().endsWith('.pdf')) {
          // PDFはDriveにアップロードしてリンク添付
          if (token) {
            setProgressMsg(`${pre}📑 PDFをDriveにアップロード中…`)
            try {
              const driveId = await uploadToDrive(new File([f.blob],f.name,{type:'application/pdf'}), token, pct=>setProgressMsg(`${pre}📑 ${pct}%`))
              html += `<span data-drive-pdf="" data-drive-id="${driveId}" data-filename="${escHtml(f.name)}"></span>`
            } catch(e) {
              // Drive失敗時はテキストとして試みる
              const txt = await f.blob.text().catch(()=>'[PDFの内容を読み取れませんでした]')
              const b64 = btoa(encodeURIComponent(txt.slice(0, 10000)))
              html += `<span data-file-attachment="" data-fa-filename="${escHtml(f.name)}" data-fa-content="${b64}"></span>`
            }
          } else {
            html += `<p>📑 ${escHtml(f.name)}（Drive未連携のためスキップ）</p>`
          }
        } else {
          // テキスト系ファイルは添付ファイルとして
          setProgressMsg(`${pre}📄 ${f.name}…`)
          const txt = await f.blob.text().catch(()=>'')
          const b64 = btoa(encodeURIComponent(txt))
          html += `<span data-file-attachment="" data-fa-filename="${escHtml(f.name)}" data-fa-content="${b64}"></span>`
        }
      }

      if (!html) { setProgressMsg('⚠️ 挿入するコンテンツがありません'); setTimeout(()=>setInserting(false),2000); return }
      setProgressMsg('💾 ノードに保存中…')
      await onInsert(nodeId, html)
      setProgressMsg('✅ 挿入完了！')
      setTimeout(()=>onClose(), 1000)
    } catch(err) {
      console.error(err)
      setProgressMsg(`❌ エラー: ${err.message}`)
      setTimeout(()=>setInserting(false), 3000)
    }
  }

  return (
    <div style={S.overlay} onClick={inserting?undefined:onClose}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <div style={S.header}>
          <div style={{flex:1}}>
            <div style={S.htitle}>📤 共有されたコンテンツ</div>
            <div style={S.hsub}>{inserting ? progressMsg : 'ノードを選んでください'}</div>
          </div>
          {!inserting && <button style={S.close} onClick={onClose}>✕</button>}
        </div>
        {progressMsg && (
          <div style={{...S.prog, background: progressMsg.startsWith('✅')?'#d1fae5':progressMsg.startsWith('❌')?'#fee2e2':'var(--accent-bg)', color: progressMsg.startsWith('✅')?'#065f46':progressMsg.startsWith('❌')?'#dc2626':'var(--accent)'}}>
            {progressMsg}
          </div>
        )}
        {!inserting && (
          <>
            <div style={S.preview}>
              {title && <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:4}}>{title}</div>}
              {text  && <div style={{fontSize:13,color:'var(--text)',lineHeight:1.5,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{text}</div>}
              {url   && <div style={{fontSize:12,color:'var(--accent)',wordBreak:'break-all',marginTop:4}}>{url}</div>}
              {selectedFiles.length>0 && (
                <div style={{marginTop:8,display:'flex',flexWrap:'wrap',gap:6}}>
                  {selectedFiles.map((f,i)=>(
                    <label key={i} style={S.chip}>
                      <input type="checkbox" checked={f.selected} onChange={e=>setSelectedFiles(p=>p.map((x,j)=>j===i?{...x,selected:e.target.checked}:x))} style={{width:14,height:14}}/>
                      <span style={{fontSize:12}}>{f.type?.startsWith('image/')?'🖼':f.type?.startsWith('audio/')?'🎵':f.type?.startsWith('video/')?'🎬':'📄'} {f.name}</span>
                    </label>
                  ))}
                </div>
              )}
              {!hasText&&selectedFiles.length===0&&<div style={{fontSize:12,color:'var(--text-muted)'}}>（コンテンツなし）</div>}
            </div>
            <div style={{padding:'8px 14px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
              <input type="text" placeholder="ノードを検索…" value={search} onChange={e=>setSearch(e.target.value)} autoFocus style={S.search}/>
            </div>
            <div style={S.list}>
              {filtered.length===0 ? (
                <div style={{padding:16,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>{search?'一致するノードが見つかりません':'ノードがありません'}</div>
              ) : filtered.map(n=>(
                <button key={n.id} onClick={()=>handleInsert(n.id)} style={{...S.btn,paddingLeft:14+n._depth*14}}>
                  {n._depth>0&&<span style={{color:'var(--border)',fontSize:10,flexShrink:0}}>└</span>}
                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>📄 {n.title||'無題'}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {inserting && (
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:40,flexDirection:'column',gap:12}}>
            <div style={{fontSize:40,animation:'spin 1s linear infinite',display:'inline-block'}}>⏳</div>
            <div style={{fontSize:13,color:'var(--text-muted)',textAlign:'center'}}>処理中です。しばらくお待ちください。</div>
          </div>
        )}
      </div>
    </div>
  )
}

const S = {
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'},
  modal:{background:'var(--bg)',borderRadius:16,width:380,maxWidth:'92vw',maxHeight:'85vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.25)',overflow:'hidden'},
  header:{display:'flex',alignItems:'flex-start',gap:10,padding:'14px 14px 10px',borderBottom:'1px solid var(--border)',flexShrink:0},
  htitle:{fontSize:15,fontWeight:700,color:'var(--text)'},
  hsub:{fontSize:11,color:'var(--text-muted)',marginTop:2},
  close:{background:'none',border:'none',fontSize:16,cursor:'pointer',color:'var(--text-muted)',padding:4,flexShrink:0},
  prog:{padding:'8px 14px',borderBottom:'1px solid var(--border)',flexShrink:0,fontSize:13,fontWeight:600},
  preview:{padding:'10px 14px',borderBottom:'1px solid var(--border)',background:'var(--surface)',flexShrink:0,maxHeight:130,overflowY:'auto'},
  chip:{display:'flex',alignItems:'center',gap:5,padding:'4px 8px',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',fontSize:12},
  search:{width:'100%',padding:'7px 10px',fontSize:13,border:'1px solid var(--border)',borderRadius:8,background:'var(--surface)',color:'var(--text)',outline:'none',boxSizing:'border-box'},
  list:{flex:1,overflowY:'auto'},
  btn:{display:'flex',alignItems:'center',width:'100%',paddingTop:9,paddingBottom:9,paddingRight:14,background:'none',border:'none',borderBottom:'1px solid var(--border)',textAlign:'left',fontSize:13,color:'var(--text)',cursor:'pointer',boxSizing:'border-box',gap:6},
}
