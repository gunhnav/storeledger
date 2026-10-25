import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { ConfirmContext, type ConfirmApi, type ConfirmOptions, type PromptOptions } from '../lib/confirm'

type ConfirmState = {
  kind: 'confirm'
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  resolve: (value: boolean) => void
}

type PromptState = {
  kind: 'prompt'
  title?: string
  message?: string
  value: string
  placeholder?: string
  type?: 'text' | 'password'
  minLength?: number
  required?: boolean
  confirmText?: string
  cancelText?: string
  resolve: (value: string | null) => void
}

type DialogState = ConfirmState | PromptState | null

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [dialog, setDialog] = useState<DialogState>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options
      setDialog({
        kind: 'confirm',
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText,
        cancelText: opts.cancelText,
        danger: opts.danger,
        resolve: (val) => {
          setDialog(null)
          resolve(val)
        },
      })
    })
  }, [])

  const prompt = useCallback((options: PromptOptions | string): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      const opts: PromptOptions = typeof options === 'string' ? { message: options } : options
      setDialog({
        kind: 'prompt',
        title: opts.title,
        message: opts.message,
        value: opts.defaultValue ?? '',
        placeholder: opts.placeholder,
        type: opts.type ?? 'text',
        minLength: opts.minLength,
        required: opts.required,
        confirmText: opts.confirmText,
        cancelText: opts.cancelText,
        resolve: (val) => {
          setDialog(null)
          resolve(val)
        },
      })
    })
  }, [])

  const api = useMemo<ConfirmApi>(() => ({ confirm, prompt }), [confirm, prompt])

  // Tự động focus nút hoặc input phù hợp khi mở modal
  useEffect(() => {
    if (!dialog) return
    const timer = setTimeout(() => {
      if (dialog.kind === 'prompt') {
        inputRef.current?.focus()
        inputRef.current?.select()
      } else if (dialog.danger) {
        cancelBtnRef.current?.focus()
      } else {
        confirmBtnRef.current?.focus()
      }
    }, 40)
    return () => clearTimeout(timer)
  }, [dialog])

  // Lắng nghe phím Escape để huỷ bỏ
  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (dialog.kind === 'confirm') dialog.resolve(false)
        else dialog.resolve(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog])

  const handleCancel = () => {
    if (!dialog) return
    if (dialog.kind === 'confirm') dialog.resolve(false)
    else dialog.resolve(null)
  }

  const handleConfirm = () => {
    if (!dialog) return
    if (dialog.kind === 'confirm') {
      dialog.resolve(true)
    } else {
      if (dialog.required && !dialog.value.trim()) return
      if (dialog.minLength && dialog.value.length < dialog.minLength) return
      dialog.resolve(dialog.value)
    }
  }

  const isPromptValid =
    dialog?.kind === 'prompt'
      ? (!dialog.required || dialog.value.trim().length > 0) &&
        (!dialog.minLength || dialog.value.length >= dialog.minLength)
      : true

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {dialog && (
        <div
          className="confirm-backdrop"
          onClick={handleCancel}
          role="presentation"
        >
          <div
            className="confirm-modal"
            role={dialog.kind === 'confirm' && dialog.danger ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            aria-describedby="confirm-modal-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-header">
              <div
                className={`confirm-icon-badge ${
                  dialog.kind === 'confirm' && dialog.danger ? 'danger' : 'accent'
                }`}
                aria-hidden="true"
              >
                {dialog.kind === 'confirm' && dialog.danger ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                ) : dialog.kind === 'prompt' ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
              </div>
              <div className="confirm-title-wrap">
                <h3 id="confirm-modal-title" className="confirm-title">
                  {dialog.title || (dialog.kind === 'confirm' && dialog.danger ? t('Xác nhận thao tác') : t('Xác nhận'))}
                </h3>
              </div>
            </div>

            {dialog.message && (
              <p id="confirm-modal-desc" className="confirm-message">
                {dialog.message}
              </p>
            )}

            {dialog.kind === 'prompt' && (
              <form
                className="confirm-prompt-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (isPromptValid) handleConfirm()
                }}
              >
                <input
                  ref={inputRef}
                  className="confirm-input"
                  type={dialog.type}
                  value={dialog.value}
                  placeholder={dialog.placeholder}
                  onChange={(e) =>
                    setDialog((prev) => (prev?.kind === 'prompt' ? { ...prev, value: e.target.value } : prev))
                  }
                />
              </form>
            )}

            <div className="confirm-actions">
              {dialog.cancelText !== '' && (
                <button
                  ref={cancelBtnRef}
                  type="button"
                  className="confirm-btn-cancel"
                  onClick={handleCancel}
                >
                  {dialog.cancelText ? t(dialog.cancelText) : t('Huỷ')}
                </button>
              )}
              <button
                ref={confirmBtnRef}
                type="button"
                className={dialog.kind === 'confirm' && dialog.danger ? 'danger' : 'primary'}
                disabled={!isPromptValid}
                onClick={handleConfirm}
              >
                {dialog.confirmText ? t(dialog.confirmText) : t('Xác nhận')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
