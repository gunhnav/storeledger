import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { errorMessage, todayVN } from './format'
import { priceOn, type Allocation } from './analytics/core'
import type { AnalyticsInput } from './analytics/types'

export type AnalyticsData = {
  input: AnalyticsInput
  // Phần bán đã gán cho từng lô theo FIFO thật (sale_item_cost_lines)
  allocations: Allocation[]
  // Giá bán tại quầy đang áp dụng hôm nay
  currentPrice: Map<string, number>
  today: string
}

type SaleRow = {
  sale_date: string
  channel: string
  commission_rate: number
  sale_items: {
    product_id: string
    quantity: number
    unit_price: number
    sale_item_cost_lines: { batch_id: string | null; quantity: number; unit_cost: number }[]
  }[]
}

// Dữ liệu thô của một cửa hàng cho các báo cáo phân tích (chỉ admin đọc được qua RLS)
export function useAnalyticsData(storeId: string) {
  const [state, setState] = useState<{ storeId: string; data: AnalyticsData | null; error: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [products, purchases, batches, transfers, sales, expenses] = await Promise.all([
        supabase.from('products').select('*').eq('store_id', storeId),
        supabase.from('purchases').select('id, purchase_date, note').eq('store_id', storeId).order('purchase_date').order('created_at'),
        supabase.from('stock_batches').select('id, purchase_id, product_id, received_date, initial_qty, unit_cost').eq('store_id', storeId),
        supabase.from('stock_transfers').select('product_id, quantity, transfer_date, destination').eq('store_id', storeId),
        supabase
          .from('sales')
          .select('sale_date, channel, commission_rate, sale_items(product_id, quantity, unit_price, sale_item_cost_lines(batch_id, quantity, unit_cost))')
          .eq('store_id', storeId),
        supabase.from('expenses').select('expense_date, amount').eq('store_id', storeId),
      ])
      const firstError = [products, purchases, batches, transfers, sales, expenses].find((r) => r.error)?.error
      if (firstError) throw firstError

      const productIds = (products.data ?? []).map((p) => p.id)
      const prices =
        productIds.length === 0
          ? { data: [], error: null }
          : await supabase.from('product_prices').select('product_id, effective_from, sale_price').in('product_id', productIds)
      if (prices.error) throw prices.error

      const batchPurchase = new Map((batches.data ?? []).map((b) => [b.id, b.purchase_id]))
      const saleRows = (sales.data ?? []) as unknown as SaleRow[]
      const input: AnalyticsInput = {
        products: (products.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          threshold: p.low_stock_threshold,
          tracksStock: p.tracks_stock,
        })),
        purchases: (purchases.data ?? []).map((p) => ({ id: p.id, date: p.purchase_date, note: p.note })),
        batchLines: (batches.data ?? []).map((b) => ({
          id: b.id,
          purchaseId: b.purchase_id,
          date: b.received_date,
          productId: b.product_id,
          qty: b.initial_qty,
          unitCost: b.unit_cost,
        })),
        sales: saleRows.flatMap((s) =>
          s.sale_items.map((i) => ({
            date: s.sale_date,
            productId: i.product_id,
            qty: i.quantity,
            unitPrice: i.unit_price,
            commissionRate: s.commission_rate,
            channel: s.channel,
            cost: i.sale_item_cost_lines.reduce((total, c) => total + c.quantity * c.unit_cost, 0),
          })),
        ),
        transfers: (transfers.data ?? []).map((t) => ({ date: t.transfer_date, productId: t.product_id, qty: t.quantity, destination: t.destination })),
        expenses: (expenses.data ?? []).map((e) => ({ date: e.expense_date, amount: e.amount })),
        prices: (prices.data ?? []).map((p) => ({ productId: p.product_id, effectiveFrom: p.effective_from, salePrice: p.sale_price })),
      }

      // Doanh thu của phần lấy từ lô = số lượng × đơn giá chụp × (1 − hoa hồng); giá vốn từ chính cost line
      const allocations: Allocation[] = saleRows.flatMap((s) =>
        s.sale_items.flatMap((i) =>
          i.sale_item_cost_lines
            .filter((c) => c.batch_id !== null)
            .map((c) => ({
              batchLineId: c.batch_id!,
              purchaseId: batchPurchase.get(c.batch_id!) ?? '',
              productId: i.product_id,
              date: s.sale_date,
              qty: c.quantity,
              revenue: c.quantity * i.unit_price * (1 - s.commission_rate),
              cost: c.quantity * c.unit_cost,
            })),
        ),
      )

      const today = todayVN()
      const currentPrice = new Map(input.products.map((p) => [p.id, priceOn(input.prices, p.id, today)]))
      return { input, allocations, currentPrice, today }
    }

    load()
      .then((data) => {
        if (!cancelled) setState({ storeId, data, error: null })
      })
      .catch((error) => {
        if (!cancelled) setState({ storeId, data: null, error: errorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  const ready = state?.storeId === storeId
  return { loading: !ready, error: ready ? state.error : null, data: ready ? state.data : null }
}
