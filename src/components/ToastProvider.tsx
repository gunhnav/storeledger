import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { ToastContext, type ToastApi, type ToastKind } from '../lib/toast'

const DURATION = 3000

type Toast = { id: number; kind: ToastKind; text: string }

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), [])

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = ++nextId.current
      setToasts((list) => [...list.slice(-2), { id, kind, text }])
      window.setTimeout(() => dismiss(id), DURATION)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({ success: (text) => push('success', text), error: (text) => push('error', text) }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span className="toast-icon" aria-hidden="true">
              {toast.kind === 'success' ? '✓' : '!'}
            </span>
            <span className="toast-text">{t(toast.text)}</span>
            <button type="button" className="toast-close" aria-label={t('Đóng')} onClick={() => dismiss(toast.id)}>
              ×
            </button>
            <span className="toast-timer" style={{ animationDuration: `${DURATION}ms` }} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
