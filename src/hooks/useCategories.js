import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { cacheCategories, getCachedCategories } from '../utils/offlineDB'

export function useCategories(userId) {
  const [categories, setCategories] = useState([])
  const [activeCategoryId, setActiveCategoryId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  // カテゴリ一覧を取得し、なければデフォルトを作成
  const fetchCategories = useCallback(async () => {
    if (!userId) return
    setFetchError(false)
    setLoading(true)
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true })

    if (error) {
      // キャッシュから復元を試みる
      const cached = await getCachedCategories(userId)
      if (cached && cached.length > 0) {
        console.warn('categories fetch error – using offline cache:', error)
        setCategories(cached)
        const savedId = localStorage.getItem(`namamemo_category_${userId}`)
        const valid = cached.find(c => c.id === savedId)
        setActiveCategoryId(valid ? valid.id : cached[0]?.id ?? null)
        setLoading(false)
        return // キャッシュで復旧できたのでエラー扱いしない
      }
      console.error('categories fetch error:', error)
      setFetchError(true)
      setLoading(false)
      return
    }

    let cats = data || []

    if (cats.length === 0) {
      // localStorage にカテゴリIDが保存されていれば既存ユーザー → 自動作成しない
      // （Supabase不調で空配列が返ってきた際の誤作成を防止）
      const prevCategoryId = localStorage.getItem(`namamemo_category_${userId}`)
      if (prevCategoryId) {
        // キャッシュから復元を試みる
        const cached = await getCachedCategories(userId)
        if (cached && cached.length > 0) {
          console.warn('categories empty but cache exists – using offline cache')
          setCategories(cached)
          const valid = cached.find(c => c.id === prevCategoryId)
          setActiveCategoryId(valid ? valid.id : cached[0]?.id ?? null)
          setLoading(false)
          return
        }
        // キャッシュもない = 本当に不調
        console.warn('categories: user has prior category but fetch returned empty – treating as fetch error')
        setFetchError(true)
        setLoading(false)
        return
      }
      // 本当に新規ユーザー → 「無題のカテゴリ」を自動作成
      const { data: newCat, error: insertErr } = await supabase
        .from('categories')
        .insert({ user_id: userId, name: '無題のカテゴリ', position: 0 })
        .select()
        .single()
      if (!insertErr && newCat) cats = [newCat]
    }

    // 成功したらキャッシュに保存
    cacheCategories(userId, cats).catch(() => {})

    setCategories(cats)

    // 前回選択カテゴリをlocalStorageから復元
    const savedId = localStorage.getItem(`namamemo_category_${userId}`)
    const valid = cats.find(c => c.id === savedId)
    setActiveCategoryId(valid ? valid.id : cats[0]?.id ?? null)
    setLoading(false)
  }, [userId])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  // activeCategoryIdが変わったらlocalStorageに保存
  useEffect(() => {
    if (userId && activeCategoryId) {
      localStorage.setItem(`namamemo_category_${userId}`, activeCategoryId)
    }
  }, [userId, activeCategoryId])

  // カテゴリ追加
  const addCategory = useCallback(async (name = '無題のカテゴリ') => {
    const maxPos = categories.length > 0 ? Math.max(...categories.map(c => c.position)) : -1
    const { data, error } = await supabase
      .from('categories')
      .insert({ user_id: userId, name, position: maxPos + 1 })
      .select()
      .single()
    if (error) { console.error(error); return null }
    setCategories(prev => [...prev, data])
    return data
  }, [userId, categories])

  // カテゴリ名変更
  const renameCategory = useCallback(async (id, name) => {
    const { error } = await supabase
      .from('categories')
      .update({ name })
      .eq('id', id)
      .eq('user_id', userId)
    if (!error) setCategories(prev => prev.map(c => c.id === id ? { ...c, name } : c))
  }, [userId])

  // カテゴリ削除（カテゴリ内のノードも cascade で消える）
  const deleteCategory = useCallback(async (id) => {
    if (categories.length <= 1) {
      alert('最後のカテゴリは削除できません')
      return
    }
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) { console.error(error); return }
    const next = categories.filter(c => c.id !== id)
    setCategories(next)
    if (activeCategoryId === id) setActiveCategoryId(next[0]?.id ?? null)
  }, [userId, categories, activeCategoryId])

  // カテゴリ並べ替え（ドラッグ後に新順序配列を渡す）
  const reorderCategories = useCallback(async (ordered) => {
    setCategories(ordered) // 楽観的更新
    await Promise.all(
      ordered.map((c, i) =>
        supabase.from('categories').update({ position: i }).eq('id', c.id)
      )
    )
  }, [])

  // 既存ノードをカテゴリに紐付ける（移行用）
  const migrateUncategorizedNodes = useCallback(async (categoryId) => {
    await supabase
      .from('nodes')
      .update({ category_id: categoryId })
      .eq('user_id', userId)
      .is('category_id', null)
  }, [userId])

  return {
    categories, activeCategoryId, setActiveCategoryId, loading, fetchError,
    addCategory, renameCategory, deleteCategory, reorderCategories,
    migrateUncategorizedNodes,
    refetchCategories: fetchCategories,
  }
}
