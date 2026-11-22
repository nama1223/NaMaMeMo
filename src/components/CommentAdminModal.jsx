import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { useDialog } from './DialogProvider'

// コメント管理パネル（持ち主用 v1.11）
// ノード単位で: 承認／削除／返信／自分の返信の修正。開いたら既読化する
// （承認待ちは処理するまでバッジに残り続ける）

const MAX_CHARS = 4000
const charCount = (s) => [...(s || '')].length

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function CommentAdminModal({ node, onClose, onChanged }) {
  const { confirm, toast } = useDialog()
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [replyTo, setReplyTo] = useState(null) // コメントID
  const [replyBody, setReplyBody] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [busy, setBusy] = useState(false)

  const fetchComments = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_owner_comments', { p_node_id: node.id })
    if (error) {
      setLoadError('コメントを読み込めませんでした。データベースの準備（SQLの実行）が済んでいるか確認してください')
      setLoading(false)
      return
    }
    setComments(data || [])
    setLoading(false)
  }, [node.id])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await fetchComments()
      if (cancelled) return
      // 開いたら既読化（バッジの未読分が消える。承認待ちは残る）
      await supabase.rpc('mark_comments_read', { p_node_id: node.id })
      if (!cancelled) onChanged?.()
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  const refresh = async () => { await fetchComments(); onChanged?.() }

  const handleApprove = async (c) => {
    setBusy(true)
    const { data } = await supabase.rpc('moderate_comment', { p_comment_id: c.id, p_action: 'approve' })
    setBusy(false)
    if (data?.ok) { toast('承認しました'); refresh() } else toast('承認に失敗しました')
  }

  const handleDelete = async (c) => {
    if (!(await confirm(`このコメントを削除しますか？\n（返信も一緒に消えます）`))) return
    setBusy(true)
    const { data } = await supabase.rpc('moderate_comment', { p_comment_id: c.id, p_action: 'delete' })
    setBusy(false)
    if (data?.ok) { toast('削除しました'); refresh() } else toast('削除に失敗しました')
  }

  const handleReply = async (c) => {
    const text = replyBody.trim()
    if (!text) return
    setBusy(true)
    const { data, error } = await supabase.rpc('owner_reply', {
      p_node_id: node.id, p_parent_id: c.id, p_body: text,
    })
    setBusy(false)
    if (!error && data?.ok) {
      setReplyTo(null); setReplyBody('')
      toast('返信しました'); refresh()
    } else {
      toast('返信に失敗しました')
    }
  }

  const handleEditSave = async (c) => {
    const text = editBody.trim()
    if (!text) return
    setBusy(true)
    const { data, error } = await supabase.rpc('owner_update_comment', {
      p_comment_id: c.id, p_body: text,
    })
    setBusy(false)
    if (!error && data?.ok) {
      setEditingId(null)
      toast('修正しました'); refresh()
    } else {
      toast('修正に失敗しました')
    }
  }

  const topLevel = comments.filter(c => !c.parent_id)
  const repliesOf = (id) => comments.filter(c => c.parent_id === id)
  const pendingCount = comments.filter(c => c.status === 'pending' && !c.is_owner).length

  const renderComment = (c, isReply) => (
    <div key={c.id} style={{
      marginLeft: isReply ? 22 : 0, marginTop: 8,
      padding: '10px 12px', borderRadius: 8,
      background: c.status === 'pending' ? '#fffbeb' : 'var(--surface)',
      border: c.is_owner ? '1px solid var(--border)' : '1px solid var(--border)',
      borderLeft: c.is_owner ? '3px solid var(--accent)' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: c.is_owner ? 'var(--accent)' : 'var(--text)' }}>{c.author_name}</span>
        {c.is_owner && <span style={{ fontSize: 10, fontWeight: 700, color: 'white', background: 'var(--accent)', borderRadius: 4, padding: '1px 5px' }}>管理人</span>}
        {c.status === 'pending' && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 4, padding: '1px 5px' }}>
            {c.hold_reason === 'ng_word' ? '保留中（言葉づかい）' : '承認待ち'}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(c.created_at)}</span>
        {c.edited_at && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（編集済み {fmtDate(c.edited_at)}）</span>}
      </div>

      {editingId === c.id ? (
        <div>
          <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={3}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.6, padding: 8, border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical', background: 'var(--bg)', color: 'var(--text)' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: charCount(editBody) > MAX_CHARS ? '#dc2626' : 'var(--text-muted)' }}>{charCount(editBody)} / {MAX_CHARS}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setEditingId(null)} style={miniBtn}>やめる</button>
            <button onClick={() => handleEditSave(c)} disabled={busy} style={{ ...miniBtn, background: 'var(--accent)', color: 'white', border: 'none', fontWeight: 600 }}>保存</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {c.status === 'pending' && (
          <button onClick={() => handleApprove(c)} disabled={busy} style={{ ...miniBtn, background: '#38a169', color: 'white', border: 'none', fontWeight: 600 }}>承認する</button>
        )}
        {!isReply && !c.is_owner && (
          <button onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyBody('') }} disabled={busy} style={miniBtn}>返信する</button>
        )}
        {c.is_owner && editingId !== c.id && (
          <button onClick={() => { setEditingId(c.id); setEditBody(c.body) }} disabled={busy} style={miniBtn}>修正</button>
        )}
        <button onClick={() => handleDelete(c)} disabled={busy} style={{ ...miniBtn, color: '#dc2626' }}>削除</button>
      </div>

      {replyTo === c.id && (
        <div style={{ marginTop: 8 }}>
          <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} rows={3} autoFocus
            placeholder="返信を書く（管理者名で表示されます）"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.6, padding: 8, border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical', background: 'var(--bg)', color: 'var(--text)' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: charCount(replyBody) > MAX_CHARS ? '#dc2626' : 'var(--text-muted)' }}>{charCount(replyBody)} / {MAX_CHARS}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setReplyTo(null)} style={miniBtn}>やめる</button>
            <button onClick={() => handleReply(c)} disabled={busy || !replyBody.trim()} style={{ ...miniBtn, background: 'var(--accent)', color: 'white', border: 'none', fontWeight: 600 }}>返信を投稿</button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--bg)', borderRadius: 14, width: 'min(560px,94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.25)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>💬 コメント管理</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              「{node.title || '無題のメモ'}」{pendingCount > 0 ? ` ／ 承認待ち ${pendingCount}件` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>読み込み中…</div>
          ) : loadError ? (
            <div style={{ fontSize: 13, color: '#dc2626', lineHeight: 1.7, padding: 12 }}>{loadError}</div>
          ) : topLevel.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>このノードへのコメントはまだありません</div>
          ) : (
            topLevel.map(c => (
              <div key={c.id}>
                {renderComment(c, false)}
                {repliesOf(c.id).map(r => renderComment(r, true))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const miniBtn = {
  fontSize: 12, padding: '5px 10px', background: 'var(--bg)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
}
