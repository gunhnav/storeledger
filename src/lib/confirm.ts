import { createContext, useContext } from 'react'

export type ConfirmOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export type PromptOptions = {
  title?: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  type?: 'text' | 'password'
  minLength?: number
  required?: boolean
}

export type ConfirmApi = {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>
  prompt: (options: PromptOptions | string) => Promise<string | null>
}

export const ConfirmContext = createContext<ConfirmApi | null>(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}

export function usePrompt() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('usePrompt must be used within ConfirmProvider')
  return ctx.prompt
}
