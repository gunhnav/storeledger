import { addDays } from '../format'
import { sum } from './core'
import type { BatchStat } from './batches'
import type { AnalyticsInput } from './types'

// Kỳ bán của đợt k: từ ngày nhập đợt k đến trước ngày nhập đợt k+1 (đợt cuối: đến hôm nay)
export type SalesPeriod = {
  purchaseId: string
  from: string
  to: string
  sold: Record<string, number>
  total: number
  topProductId: string | null
  topQty: number
  // Tỷ trọng của loại bán chạy nhất trong kỳ (0..1)
  topShare: number | null
}

export function salesPeriods(input: AnalyticsInput, today: string): SalesPeriod[] {
  const stocked = input.products.filter((p) => p.tracksStock)
  const withLines = new Set(input.batchLines.map((b) => b.purchaseId))
  const purchases = [...input.purchases].filter((p) => withLines.has(p.id)).sort((a, b) => a.date.localeCompare(b.date))
  return purchases.map((purchase, k) => {
    const next = purchases[k + 1]
    const from = purchase.date
    const to = next ? addDays(next.date, -1) : today
    const sold: Record<string, number> = {}
    for (const p of stocked) {
      sold[p.id] = sum(input.sales.filter((s) => s.productId === p.id && s.date >= from && s.date <= to).map((s) => s.qty))
    }
    const total = sum(Object.values(sold))
    let topProductId: string | null = null
    for (const p of stocked) if (sold[p.id] > 0 && (topProductId === null || sold[p.id] > sold[topProductId])) topProductId = p.id
    const topQty = topProductId ? sold[topProductId] : 0
    return { purchaseId: purchase.id, from, to, sold, total, topProductId, topQty, topShare: total > 0 ? topQty / total : null }
  })
}

// Tỷ lệ bán hết từng loại trong chính đợt đó (hũ đã bán gán cho đợt ÷ hũ nhập đợt)
export type SellThrough = {
  purchaseId: string
  rates: Record<string, number>
  // Loại bán hết nhanh nhất: tỷ lệ cao nhất, bằng nhau thì hết sớm hơn
  fastestProductId: string | null
}

export function sellThrough(batches: BatchStat[]): SellThrough[] {
  return batches.map((b) => {
    const rates: Record<string, number> = {}
    for (const line of b.lines) rates[line.productId] = line.qty > 0 ? line.sold / line.qty : 0
    const ranked = [...b.lines]
      .filter((l) => l.sold > 0)
      .sort(
        (x, y) =>
          rates[y.productId] - rates[x.productId] ||
          (x.soldOutDate ?? '9999').localeCompare(y.soldOutDate ?? '9999'),
      )
    return { purchaseId: b.purchaseId, rates, fastestProductId: ranked[0]?.productId ?? null }
  })
}

export type SuggestionBasis = 'last' | 'all'

export type SuggestionRow = {
  productId: string
  rank: number
  sold: number
  share: number
  suggested: number
}

// Gợi ý số hũ mỗi loại cho đợt sau = round(tổng dự định × tỷ trọng bán).
// null khi chưa có số liệu bán.
export function suggestNextBatch(
  periods: SalesPeriod[],
  productIds: string[],
  plannedTotal: number,
  basis: SuggestionBasis,
): SuggestionRow[] | null {
  const source = basis === 'last' ? periods.slice(-1) : periods
  const sold = productIds.map((id) => sum(source.map((p) => p.sold[id] ?? 0)))
  const total = sum(sold)
  if (total <= 0) return null
  return productIds
    .map((productId, i) => ({ productId, sold: sold[i], share: sold[i] / total, suggested: Math.round(plannedTotal * (sold[i] / total)), order: i }))
    .sort((a, b) => b.sold - a.sold || a.order - b.order)
    .map(({ productId, sold: qty, share, suggested }, index) => ({ productId, rank: index + 1, sold: qty, share, suggested }))
}
