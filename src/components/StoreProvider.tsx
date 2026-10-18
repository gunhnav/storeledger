import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { StoreContext, type StoreState } from '../lib/store'
import { errorMessage } from '../lib/format'
import type { Store } from '../types/database'

const STORAGE_KEY = 'web-nhap-lieu.store'

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

// Danh sách cửa hàng người dùng thấy được (RLS: admin thấy tất cả, nhân viên thấy cửa hàng mình)
export function StoreProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<Store[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(readSaved)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('stores')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(errorMessage(error))
        else setStores(data)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const select = useCallback((storeId: string) => {
    setSelectedId(storeId)
    try {
      localStorage.setItem(STORAGE_KEY, storeId)
    } catch {
      // Không lưu được thì thôi, chỉ mất lựa chọn khi tải lại trang
    }
  }, [])

  const current = stores.find((s) => s.id === selectedId) ?? stores[0] ?? null

  const value = useMemo<StoreState>(
    () => ({ stores, current, loading, error, select }),
    [stores, current, loading, error, select],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
