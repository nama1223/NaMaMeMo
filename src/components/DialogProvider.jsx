import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const DialogContext = createContext(null)

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const [toasts, setToasts] = useState([])
  const [banners, setBanners] = useState([])
  const nextNoticeId = useRef(0)

  const confirm = useCallback((message) => new Promise(resolve => {
    setDialog({ message, type: 'confirm', resolve })
  }), [])

  const alert = useCallback((message) => new Promise(resolve => {
    setDialog({ message, type: 'alert', resolve })
  }), [])

  const toast = useCallback((message) => {
    const id = ++nextNoticeId.current
    setToasts(items => [...items, { id, message }])
    window.setTimeout(() => setToasts(items => items.filter(item => item.id !== id)), 4000)
  }, [])

  const banner = useCallback((message) => {
    setBanners(items => items.some(item => item.message === message)
      ? items
      : [...items, { id: ++nextNoticeId.current, message }])
  }, [])

  const dismissBanner = useCallback((id) => setBanners(items => items.filter(item => item.id !== id)), [])

  const close = (result) => {
    dialog?.resolve(result)
    setDialog(null)
  }

  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && dialog.type === 'confirm') close(false)
      if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog])

  return (
    <DialogContext.Provider value={{ confirm, alert, toast, banner }}>
      {children}
      <div className="app-notice-banners" aria-live="polite">
        {banners.map(item => <div className="app-notice-banner" key={item.id}>
          <span className="app-notice-message">{item.message}</span>
          <button type="button" aria-label="通知を閉じる" onClick={() => dismissBanner(item.id)}>閉じる</button>
        </div>)}
      </div>
      <div className="app-notice-toasts" aria-live="polite">
        {toasts.map(item => <div className="app-notice-toast" key={item.id}>{item.message}</div>)}
      </div>
      {dialog && (
        <div className="app-dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget && dialog.type === 'confirm') close(false) }}>
          <div className="app-dialog" role="alertdialog" aria-modal="true" aria-label="確認">
            <p className="app-dialog-message">{dialog.message}</p>
            <div className="app-dialog-actions">
              {dialog.type === 'confirm' && <button className="app-dialog-cancel" onClick={() => close(false)}>キャンセル</button>}
              <button className="app-dialog-ok" autoFocus onClick={() => close(true)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

export function useDialog() {
  const value = useContext(DialogContext)
  if (!value) throw new Error('useDialog must be used within DialogProvider')
  return value
}
