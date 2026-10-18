import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { shopStatusOf, stockAlerts, type StockAlerts } from './analytics/overview'

// Banner hết / sắp hết cho mọi người dùng (kể cả nhân viên): chỉ dùng số lượng từ get_stock_status
// và stock_transfers (đã từng mang ra hay chưa), không đọc giá vốn hay chi phí.
export function useStockAlerts(storeId: string, version = 0): StockAlerts | null {
  const [state, setState] = useState<{ key: string; alerts: StockAlerts } | null>(null)
  const key = `${storeId}|${version}`

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.rpc('get_stock_status', { p_store_id: storeId }),
      supabase.from('stock_transfers').select('product_id').eq('store_id', storeId),
    ]).then(([status, transfers]) => {
      if (cancelled || status.error) return
      const moved = new Set((transfers.data ?? []).map((t) => t.product_id))
      const rows = (status.data ?? []).map((r) => ({
        name: r.product_name,
        shopStatus: shopStatusOf(r.qty_shop, moved.has(r.product_id), r.low_stock_threshold),
      }))
      setState({ key, alerts: stockAlerts(rows) })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, key])

  return state?.key === key ? state.alerts : null
}
