import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { errorMessage } from './format'
import type { Product, StockStatusRow } from '../types/database'

type Catalog = {
  storeId: string
  products: Product[]
  stock: Map<string, StockStatusRow>
  error: string | null
}

// Sản phẩm đang bán và tồn kho (chỉ số lượng) của một cửa hàng
export function useStoreCatalog(storeId: string) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase
        .from('products')
        .select('*')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('name'),
      supabase.rpc('get_stock_status', { p_store_id: storeId }),
    ]).then(([products, stock]) => {
      if (cancelled) return
      const error = products.error ?? stock.error
      setCatalog({
        storeId,
        products: products.data ?? [],
        stock: new Map((stock.data ?? []).map((row) => [row.product_id, row])),
        error: error ? errorMessage(error) : null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, version])

  // Tải lại sau khi ghi giao dịch để số tồn kho cập nhật
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  const ready = catalog?.storeId === storeId
  return {
    loading: !ready,
    error: ready ? catalog.error : null,
    products: ready ? catalog.products : [],
    stock: ready ? catalog.stock : new Map<string, StockStatusRow>(),
    reload,
  }
}
