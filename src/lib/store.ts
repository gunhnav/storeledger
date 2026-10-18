import { createContext, useContext } from 'react'
import type { Store } from '../types/database'

export type StoreState = {
  stores: Store[]
  current: Store | null
  loading: boolean
  error: string | null
  select: (storeId: string) => void
}

export const StoreContext = createContext<StoreState | null>(null)

export function useStore(): StoreState {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore phải dùng bên trong <StoreProvider>')
  return ctx
}
