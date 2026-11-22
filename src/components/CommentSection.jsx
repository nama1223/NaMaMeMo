import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// 公開ページ用コメント欄（v1.11）
// - 表示・投稿・自分の投稿の修正だけを行う。判定は全部サーバー側RPC
// - オフの時は PublicViewer 側がこのコンポーネント自体を出さない
// - 速すぎ判定（5秒）は表示上の配慮としてここで持ち、引っかかったら理由＋残り秒数を出す
//   （実防御はサーバー側の連投制限180秒・ハニーポット・承認制）

const TOKENS_KEY = 'namamemo-comment-tokens'
const NAME_KEY = 'namamemo-comment-name'
const MAX_CHARS = 4000
const MAX_URLS = 5
const MIN_WAIT_MS = 5000

const charCount = (s) => [...(s || '')].length
const urlCount = (s) => ((s || '').match(/https?:\/\/|www\./gi) || []).length

function loadTokens() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}')
    return t && typeof t === 'object' ? t : {}
  } catch { return {} }
}
function saveTokens(t) {
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(t)) } catch { /* 保存できなくても続行 */ }
}
function newToken() {
  const a = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  const b = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return (a + b).replace(/-/g, '')
}
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const ERROR_TEXT = {
  empty: '本文が空です',
  too_long: `本文は${MAX_CHARS}文字までです`,
  too_many_urls: `URLは${MAX_URLS}つまでです`,
  duplicate: '直前と同じ内容は続けて投稿できません',
  comments_off: 'このページではコメントを受け付けていません',
  not_public: 'このページではコメントを受け付けていません',
  bad_token: '修正の確認ができませんでした（投稿した時と同じブラウザで開いてください）',
  not_found: '対象のコメントが見つかりませんでした',
  not_yours: 'このコメントは修正できません',
}

export default function CommentSection({ rootId, nodeId, mode, adminName }) {
  const [comments, setComments] = useState([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' } })
  const [body, setBody] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null) // { kind: 'info'|'error'|'wait', text, until }
  const [now, setNow] = useState(() => Date.now())
  const [editingId, setEditingId] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const openedAtRef = useRef(0)
  const [tokens, setTokens] = useState(loadTokens)

  // 残り秒数のカウントダウン表示用
  useEffect(() => {
    if (!notice?.until) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [notice])

  const fetchComments = useCallback(async () => {
    const myIds = Object.keys(tokens)
    const { data, error } = await supabase.rpc('get_public_comments', {
      p_root_id: rootId, p_node_id: nodeId, p_my_ids: myIds,
    })
    if (error) { setLoadFailed(true); return }
    setLoadFailed(false)
    setComments(data || [])
  }, [rootId, nodeId, tokens])

  useEffect(() => { openedAtRef.current = Date.now(); fetchComments() }, [fetchComments])

  if (loadFailed) return null // RPC未整備などの時は欄ごと出さない

  const topLevel = comments.filter(c => !c.parent_id)
  const repliesOf = (id) => comments.filter(c => c.parent_id === id)

  const waitRemaining = notice?.until ? Math.max(0, Math.ceil((notice.until - now) / 1000)) : 0

  const handleSubmit = async () => {
    const text = body.trim()
    if (!text) { setNotice({ kind: 'error', text: ERROR_TEXT.empty }); return }
    if (charCount(text) > MAX_CHARS) { setNotice({ kind: 'error', text: ERROR_TEXT.too_long }); return }
    if (urlCount(text) > MAX_URLS) { setNotice({ kind: 'error', text: ERROR_TEXT.too_many_urls }); return }

    // 速すぎ判定（5秒）: 却下ではなく「あと◯秒で送れる」表示
    const elapsed = Date.now() - openedAtRef.current
    if (elapsed < MIN_WAIT_MS) {
      setNotice({
        kind: 'wait',
        text: '投稿の準備中です。少し待ってから送信してください',
        until: openedAtRef.current + MIN_WAIT_MS,
      })
      return
    }

    setSubmitting(true)
    setNotice(null)
    const token = newToken()
    const { data, error } = await supabase.rpc('post_comment', {
      p_root_id: rootId, p_node_id: nodeId,
      p_author_name: name, p_body: text,
      p_honeypot: honeypot, p_edit_token: token,
    })
    setSubmitting(false)

    if (error) { setNotice({ kind: 'error', text: '送信に失敗しました。通信環境を確認してもう一度お試しください' }); return }
    if (!data?.ok) {
      if (data?.error === 'rate_limited') {
        setNotice({
          kind: 'wait',
          text: '続けての投稿はできません。少し待ってから送信してください',
          until: Date.now() + (data.retry_after || 180) * 1000,
        })
      } else {
        setNotice({ kind: 'error', text: ERROR_TEXT[data?.error] || '投稿できませんでした' })
      }
      return
    }

    // 成功（ハニーポットのフェイク成功含む。フェイク時は id が無い）
    if (data.id) {
      const next = { ...tokens, [data.id]: token }
      setTokens(next)
      saveTokens(next)
    }
    try { localStorage.setItem(NAME_KEY, name) } catch { /* 保存できなくても続行 */ }
    setBody('')
    openedAtRef.current = Date.now()
    if (data.status === 'pending') {
      setNotice({ kind: 'info', text: '投稿を受け付けました。管理人の承認後に表示されます' })
    } else if (data.id) {
      setNotice({ kind: 'info', text: '投稿しました' })
    }
    fetchComments()
  }

  const startEdit = (c) => {
    setEditingId(c.id)
    setEditBody(c.body)
    setNotice(null)
  }

  const handleEditSave = async (c) => {
    const text = editBody.trim()
    if (!text) { setNotice({ kind: 'error', text: ERROR_TEXT.empty }); return }
    if (charCount(text) > MAX_CHARS) { setNotice({ kind: 'error', text: ERROR_TEXT.too_long }); return }
    if (urlCount(text) > MAX_URLS) { setNotice({ kind: 'error', text: ERROR_TEXT.too_many_urls }); return }
    setEditBusy(true)
    const { data, error } = await supabase.rpc('edit_comment', {
      p_comment_id: c.id, p_edit_token: tokens[c.id] || '', p_body: text,
    })
    setEditBusy(false)
    if (error) { setNotice({ kind: 'error', text: '修正の保存に失敗しました' }); return }
    if (!data?.ok) { setNotice({ kind: 'error', text: ERROR_TEXT[data?.error] || '修正できませんでした' }); return }
    setEditingId(null)
    if (data.status === 'pending') {
      setNotice({ kind: 'info', text: '修正しました。管理人の承認後に表示されます' })
    } else {
      setNotice({ kind: 'info', text: '修正しました' })
    }
    fetchComments()
  }

  const renderComment = (c, isReply) => {
    const mine = !!tokens[c.id]
    const pending = c.status === 'pending'
    return (
      <div key={c.id} style={{
        marginLeft: isReply ? 24 : 0, marginTop: isReply ? 8 : 12,
        padding: '10px 12px',
        background: isReply ? '#f7f7f8' : 'white',
        border: pending ? '1px dashed #d97706' : '1px solid #e5e5e7',
        borderLeft: c.is_owner ? '3px solid #5b6af0' : (pending ? '1px dashed #d97706' : '1px solid #e5e5e7'),
        borderRadius: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: c.is_owner ? '#5b6af0' : '#1a1a1a' }}>
            {c.author_name}
          </span>
          {c.is_owner && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'white', background: '#5b6af0', borderRadius: 4, padding: '1px 5px' }}>
              {adminName || '管理人'}
            </span>
          )}
          {pending && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 4, padding: '1px 5px' }}>承認待ち</span>
          )}
          <span style={{ fontSize: 11, color: '#8e8e93' }}>{fmtDate(c.created_at)}</span>
          {c.edited_at && (
            <span style={{ fontSize: 11, color: '#8e8e93' }}>（編集済み {fmtDate(c.edited_at)}）</span>
          )}
          {mine && !c.is_owner && editingId !== c.id && (
            <button onClick={() => startEdit(c)}
              style={{ marginLeft: 'auto', fontSize: 11, color: '#5b6af0', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
              修正する
            </button>
          )}
        </div>
        {editingId === c.id ? (
          <div>
            <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={4}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, lineHeight: 1.6, padding: 8, border: '1px solid #d9d9de', borderRadius: 6, resize: 'vertical' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 11, color: charCount(editBody) > MAX_CHARS ? '#dc2626' : '#8e8e93' }}>
                {charCount(editBody)} / {MAX_CHARS}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setEditingId(null)} disabled={editBusy}
                style={{ fontSize: 12, padding: '6px 12px', background: '#f1f1f3', border: '1px solid #e5e5e7', borderRadius: 6, cursor: 'pointer' }}>やめる</button>
              <button onClick={() => handleEditSave(c)} disabled={editBusy}
                style={{ fontSize: 12, padding: '6px 12px', background: '#5b6af0', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                {editBusy ? '保存中…' : '修正を保存'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: '#1a1a1a', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {c.body}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ borderTop: '1px solid #e5e5e7', background: '#fbfbfc', padding: '20px 32px 40px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h2 style={{ fontSize: 16, margin: '0 0 4px', color: '#1a1a1a' }}>💬 コメント（{topLevel.length}件）</h2>
        {mode === 'approval' && (
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 8 }}>コメントは管理人の承認後に表示されます</div>
        )}

        {topLevel.map(c => (
          <div key={c.id}>
            {renderComment(c, false)}
            {repliesOf(c.id).map(r => renderComment(r, true))}
          </div>
        ))}
        {topLevel.length === 0 && (
          <div style={{ fontSize: 13, color: '#8e8e93', padding: '12px 0' }}>まだコメントはありません</div>
        )}

        {/* ── 投稿フォーム ── */}
        <div style={{ marginTop: 20, padding: '14px', background: 'white', border: '1px solid #e5e5e7', borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#1a1a1a' }}>コメントを書く</div>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="名前（空なら「名無し」）" maxLength={50}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '8px 10px', border: '1px solid #d9d9de', borderRadius: 6, marginBottom: 8 }}
          />
          <textarea
            value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder="コメント本文"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, lineHeight: 1.6, padding: '8px 10px', border: '1px solid #d9d9de', borderRadius: 6, resize: 'vertical' }}
          />
          {/* ハニーポット（人間には見えない。ボット対策） */}
          <input
            value={honeypot} onChange={e => setHoneypot(e.target.value)}
            name="website" autoComplete="off" tabIndex={-1} aria-hidden="true"
            style={{ position: 'absolute', left: -9999, top: -9999, width: 1, height: 1, opacity: 0 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: charCount(body) > MAX_CHARS ? '#dc2626' : '#8e8e93' }}>
              {charCount(body)} / {MAX_CHARS}
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={handleSubmit} disabled={submitting}
              style={{ fontSize: 13, padding: '8px 20px', background: '#5b6af0', color: 'white', border: 'none', borderRadius: 8, cursor: submitting ? 'default' : 'pointer', fontWeight: 700, opacity: submitting ? 0.6 : 1 }}>
              {submitting ? '送信中…' : '投稿する'}
            </button>
          </div>
          {notice && (
            <div style={{
              marginTop: 10, fontSize: 12, lineHeight: 1.6, padding: '8px 10px', borderRadius: 6,
              color: notice.kind === 'error' ? '#b91c1c' : '#374151',
              background: notice.kind === 'error' ? '#fef2f2' : '#f1f5f9',
            }}>
              {notice.text}
              {notice.until && waitRemaining > 0 && <>（あと{waitRemaining}秒）</>}
              {notice.until && waitRemaining <= 0 && <>（もう送信できます）</>}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 8 }}>
            投稿したコメントは、投稿に使ったブラウザからだけ修正できます
          </div>
        </div>
      </div>
    </div>
  )
}
