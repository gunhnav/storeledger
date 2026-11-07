import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { shopStatusOf, stockAlerts, type StockAlerts } from './analytics/overview'
import type { StockStatusRow } from '../types/database'

// Banner hết / sắp hết cho mọi người dùng (kể cả nhân viên): chỉ dùng số lượng từ get_stock_status
// và stock_transfers (đã từng mang ra hay chưa), không đọc giá vốn hay chi phí.
// Trang đã tải get_stock_status thì truyền `rows` (null = đang tải) để không gọi RPC lần hai.
export function useStockAlerts(storeId: string, version = 0, rows?: StockStatusRow[] | null): StockAlerts | null {
  const external = rows !== undefined
  const [state, setState] = useState<{ key: string; moved: Set<string>; status: StockStatusRow[] | null } | null>(null)
  const key = `${storeId}|${version}`

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    Promise.all([
      external ? Promise.resolve(null) : supabase.rpc('get_stock_status', { p_store_id: storeId }),
      supabase.from('stock_transfers').select('product_id').eq('store_id', storeId).eq('destination', 'shop'),
    ]).then(([status, transfers]) => {
      if (cancelled || status?.error) return
      setState({ key, moved: new Set((transfers.data ?? []).map((t) => t.product_id)), status: status?.data ?? null })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, key, external])

  const source = external ? rows : state?.status
  return useMemo(() => {
    if (!state || state.key !== key || !source) return null
    return stockAlerts(
      source.map((r) => ({ name: r.product_name, shopStatus: shopStatusOf(r.qty_shop, state.moved.has(r.product_id), r.low_stock_threshold) })),
    )
  }, [state, key, source])
}
