/**
 * ReminderModal.jsx v2
 * - IndexedDBにリマインダーを永続化
 * - 通知タップ → アプリ起動 + そのノードにジャンプ（navigateToNode イベント）
 * - 通知本文にノードタイトル表示
 */
import { useState, useEffect } from 'react'
import { useDialog } from './DialogProvider'

const DB_NAME = 'namamemo_reminders', DB_VER = 1, STORE = 'reminders'

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER)
    r.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    r.onsuccess = e => res(e.target.result)
    r.onerror = e => rej(e.target.error)
  })
}
async function getForNode(nodeId) {
  try {
    const db = await openDB()
    return new Promise(res => {
      const r = db.transaction(STORE,'readonly').objectStore(STORE).getAll()
      r.onsuccess = () => res((r.result||[]).find(x => x.nodeId===nodeId && x.scheduledAt>Date.now()) || null)
      r.onerror = () => res(null)
    })
  } catch { return null }
}
async function save(reminder) {
  const db = await openDB()
  const tx = db.transaction(STORE,'readwrite'), store = tx.objectStore(STORE)
  // 同ノードの既存を削除
  const all = await new Promise(res => { const r=store.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]) })
  all.filter(x=>x.nodeId===reminder.nodeId).forEach(x=>store.delete(x.id))
  store.put(reminder)
  return new Promise((res,rej) => { tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error) })
}
async function del(id) {
  const db = await openDB()
  const tx = db.transaction(STORE,'readwrite')
  tx.objectStore(STORE).delete(id)
  return new Promise((res,rej) => { tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error) })
}

export default function ReminderModal({ node, onClose }) {
  const { toast, banner } = useDialog()
  const now = new Date()
  const toLocal = d => {
    const p = n => String(n).padStart(2,'0')
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const [existing, setExisting] = useState(null)
  const [dateValue, setDateValue] = useState(toLocal(new Date(now.getTime()+60*60*1000)))
  const [message, setMessage] = useState('')
  const [perm, setPerm] = useState(typeof Notification!=='undefined' ? Notification.permission : 'default')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getForNode(node.id).then(r => {
      if (r) { setExisting(r); setDateValue(toLocal(new Date(r.scheduledAt))); setMessage(r.message||'') }
      setLoading(false)
    })
  }, [node.id])

  const requestPerm = async () => {
    const r = await Notification.requestPermission()
    setPerm(r)
    return r
  }

  const handleSave = async () => {
    const scheduledAt = new Date(dateValue).getTime()
    if (isNaN(scheduledAt)||scheduledAt<=Date.now()) { toast('未来の日時を指定してください。'); return }
    let p = perm
    if (p!=='granted') { p = await requestPerm(); if (p!=='granted') { banner('通知を許可してください。'); return } }
    setSaving(true)
    const reminder = {
      id: existing?.id || `r_${node.id}_${Date.now()}`,
      nodeId: node.id, nodeTitle: node.title,
      scheduledAt, message, createdAt: Date.now()
    }
    await save(reminder)

    // タイマーセット
    const delay = scheduledAt - Date.now()
    setTimeout(async () => {
      const body = node.title + (message ? `\n${message}` : '')
      if (navigator.serviceWorker?.controller) {
        // SW経由：バックグラウンドでも動作、タップでノードを開く
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title: '⏰ NaMaMeMo リマインダー',
          body,
          data: { nodeId: node.id }
        })
      } else if (Notification.permission==='granted') {
        const n = new Notification('⏰ NaMaMeMo リマインダー', {
          body, icon: '/icon-192.png', tag: `reminder-${node.id}`
        })
        // タップでアプリにフォーカスしてノードを開く
        n.onclick = () => {
          window.focus()
          window.dispatchEvent(new CustomEvent('namamemo-navigate-node', { detail: { nodeId: node.id } }))
        }
      }
      await del(reminder.id)
    }, delay)

    setSaving(false)
    onClose()
  }

  const handleDelete = async () => {
    if (!existing) return
    await del(existing.id)
    onClose()
  }

  if (loading) return null

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <div style={S.header}>
          <span style={{fontSize:26}}>⏰</span>
          <div style={{flex:1}}>
            <div style={S.title}>リマインダー設定</div>
            <div style={S.sub}>{node.title}</div>
          </div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        {perm==='denied' && (
          <div style={S.warn}>⚠️ 通知がブロックされています。ブラウザの設定から許可してください。</div>
        )}
        {perm==='default' && (
          <div style={S.warnBox}>
            <div style={{fontSize:12,color:'#854d0e',marginBottom:6}}>通知の許可が必要です</div>
            <button style={S.permBtn} onClick={requestPerm}>通知を許可する</button>
          </div>
        )}

        <div style={S.body}>
          {existing && (
            <div style={S.existBox}>
              <span style={{fontSize:11,color:'var(--text-muted)'}}>現在：</span>
              <span style={{fontSize:12,fontWeight:700,color:'var(--accent)'}}>{new Date(existing.scheduledAt).toLocaleString('ja-JP')}</span>
            </div>
          )}
          <label style={S.label}>通知する日時</label>
          <input type="datetime-local" style={S.input} value={dateValue}
            onChange={e=>setDateValue(e.target.value)} min={toLocal(now)}/>

          <label style={S.label}>メモ（省略可・通知本文に追加されます）</label>
          <input type="text" style={S.input} value={message}
            onChange={e=>setMessage(e.target.value)}
            placeholder="例：資料を準備する" maxLength={80}/>

          <div style={S.preview}>
            <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:4}}>通知プレビュー</div>
            <div style={{fontSize:12,fontWeight:700}}>⏰ NaMaMeMo リマインダー</div>
            <div style={{fontSize:12,color:'var(--text-muted)'}}>{node.title}{message?`\n${message}`:''}</div>
          </div>
        </div>

        <div style={S.footer}>
          {existing && <button style={S.delBtn} onClick={handleDelete}>🗑 削除</button>}
          <button style={{...S.saveBtn,opacity:perm==='denied'?0.5:1}}
            onClick={handleSave} disabled={saving||perm==='denied'}>
            {saving?'設定中…':(existing?'⏰ 更新する':'⏰ 設定する')}
          </button>
        </div>
      </div>
    </div>
  )
}

const S = {
  overlay: {position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'},
  modal: {background:'var(--bg)',borderRadius:16,width:340,maxWidth:'92vw',boxShadow:'0 20px 60px rgba(0,0,0,0.25)',display:'flex',flexDirection:'column',overflow:'hidden'},
  header: {display:'flex',alignItems:'flex-start',gap:12,padding:'16px 16px 12px',borderBottom:'1px solid var(--border)'},
  title: {fontSize:16,fontWeight:700,color:'var(--text)',lineHeight:1.3},
  sub: {fontSize:12,color:'var(--text-muted)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:220},
  closeBtn: {background:'none',border:'none',fontSize:15,cursor:'pointer',color:'var(--text-muted)',flexShrink:0,padding:4},
  warn: {margin:'10px 16px 0',padding:'10px 14px',background:'#fee2e2',borderRadius:10,fontSize:12,color:'#dc2626'},
  warnBox: {margin:'10px 16px 0',padding:'10px 14px',background:'#fef9c3',borderRadius:10,border:'1px solid #fde047'},
  permBtn: {padding:'5px 14px',background:'#d97706',color:'white',border:'none',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:600},
  body: {padding:'14px 16px',display:'flex',flexDirection:'column',gap:8},
  existBox: {display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',padding:'7px 10px',background:'var(--accent-bg)',borderRadius:8},
  label: {fontSize:12,fontWeight:600,color:'var(--text-muted)'},
  input: {padding:'9px 12px',border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',color:'var(--text)',fontSize:14,outline:'none',width:'100%',boxSizing:'border-box'},
  preview: {padding:'10px 12px',background:'var(--surface)',borderRadius:8,border:'1px solid var(--border)'},
  footer: {display:'flex',gap:8,padding:'0 16px 16px'},
  delBtn: {padding:'10px 14px',background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:10,fontSize:13,color:'#dc2626',cursor:'pointer',fontWeight:600},
  saveBtn: {flex:1,padding:'10px 0',background:'var(--accent)',border:'none',borderRadius:10,fontSize:14,color:'white',cursor:'pointer',fontWeight:700},
}
