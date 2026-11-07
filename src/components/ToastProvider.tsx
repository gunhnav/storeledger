/* Lucian UX/UI Prompt #070 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#070 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import '../lucian/tokens.css'
import '../lucian/u070-toasts.css'
import { useI18n } from '../lib/i18n'
import { ToastContext, type ToastApi } from '../lib/toast'
import { createToastStack, type StackKind, type ToastStack } from '../lib/toastStack'

// Thông báo nổi dạng chồng (Lucian #070) dùng chung cho Sổ Xanh và trang khách Hogi
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const zoneRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<ToastStack | null>(null)
  const tRef = useRef(t)

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    const stack = createToastStack(zoneRef.current!, liveRef.current!, () => tRef.current('Đóng'))
    stackRef.current = stack
    return () => {
      stack.destroy()
      stackRef.current = null
    }
  }, [])

  const api = useMemo<ToastApi>(() => {
    const push = (kind: StackKind) => (text: string) => stackRef.current?.push(kind, tRef.current(text))
    return { success: push('success'), error: push('error') }
  }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ux u070">
        <div ref={zoneRef} className="u070-zone" role="region" aria-label={t('Thông báo')} tabIndex={-1}>
          <div ref={liveRef} className="u070-live" aria-live="polite" />
        </div>
      </div>
    </ToastContext.Provider>
  )
}
