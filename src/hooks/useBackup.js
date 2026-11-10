import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'

export function useBackup(userId, nodes, settings) {
  const timerRef = useRef(null)
  // 前回バックアップ時のノード内容を記録
  const lastBackupSnapshot = useRef(null)

  const runBackup = useCallback(async (force = false) => {
    if (!userId || !nodes.length) return false

    // スナップショット（id+title+contentの文字列）を作って差分チェック
    const snapshot = nodes
      .map(n => `${n.id}:${n.title}:${n.content || ''}`)
      .sort()
      .join('|')

    if (!force && lastBackupSnapshot.current === snapshot) {
      console.log('バックアップ: 変更なし、スキップ')
      return false
    }

    const now = new Date().toISOString()
    const rows = nodes.map(n => ({
      user_id: userId,
      node_id: n.id,
      title: n.title,
      content: n.content || '',
      backed_up_at: now,
    }))

    const { error: insertError } = await supabase
      .from('node_backups')
      .insert(rows)

    if (insertError) {
      console.error('バックアップ失敗:', insertError.message)
      return false
    }

    lastBackupSnapshot.current = snapshot

    // 古いバックアップセットを削除（上限件数を超えた分）
    const { data: allBackups } = await supabase
      .from('node_backups')
      .select('backed_up_at')
      .eq('user_id', userId)
      .order('backed_up_at', { ascending: false })

    if (allBackups) {
      const uniqueTimes = [...new Set(allBackups.map(b => b.backed_up_at))]
      if (uniqueTimes.length > settings.backupMaxCount) {
        const toDelete = uniqueTimes.slice(settings.backupMaxCount)
        await supabase
          .from('node_backups')
          .delete()
          .eq('user_id', userId)
          .in('backed_up_at', toDelete)
      }
    }

    console.log(`バックアップ完了: ${now}`)
    return true
  }, [userId, nodes, settings.backupMaxCount])

  useEffect(() => {
    if (!settings.autoBackup || !userId) return
    const intervalMs = settings.backupIntervalMin * 60 * 1000
    timerRef.current = setInterval(() => runBackup(false), intervalMs)
    return () => clearInterval(timerRef.current)
  }, [settings.autoBackup, settings.backupIntervalMin, userId, runBackup])

  // バックアップ一覧取得
  const fetchBackupList = useCallback(async () => {
    if (!userId) return []
    const { data } = await supabase
      .from('node_backups')
      .select('backed_up_at')
      .eq('user_id', userId)
      .order('backed_up_at', { ascending: false })

    if (!data) return []
    // ユニークなbacked_up_atだけ返す
    const unique = [...new Set(data.map(b => b.backed_up_at))]
    return unique
  }, [userId])

  // 指定時刻のバックアップを取得
  const fetchBackupAt = useCallback(async (backedUpAt) => {
    if (!userId) return []
    const { data } = await supabase
      .from('node_backups')
      .select('*')
      .eq('user_id', userId)
      .eq('backed_up_at', backedUpAt)
    return data || []
  }, [userId])

  return { runBackup, fetchBackupList, fetchBackupAt }
}
