import { addDays } from '../format'
import { daysInclusive, sum } from './core'
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

export function sellThrough(batches: BatchStat[], today?: string): SellThrough[] {
  return batches.map((b) => {
    const rates: Record<string, number> = {}
    for (const line of b.lines) rates[line.productId] = line.qty > 0 ? line.sold / line.qty : 0
    // Hết nhanh nhất = bán được nhiều phần của lô nhất trong mỗi ngày (tỷ lệ ÷ số ngày), không phụ thuộc số lượng nhập
    const speed = (l: BatchStat['lines'][number]) => (today ? rates[l.productId] / lineDays(b.date, l.soldOutDate, today) : rates[l.productId])
    const ranked = [...b.lines]
      .filter((l) => l.sold > 0)
      .sort(
        (x, y) =>
          speed(y) - speed(x) ||
          rates[y.productId] - rates[x.productId] ||
          (x.soldOutDate ?? '9999').localeCompare(y.soldOutDate ?? '9999'),
      )
    return { purchaseId: b.purchaseId, rates, fastestProductId: ranked[0]?.productId ?? null }
  })
}

// Số ngày một lô đã bán: từ ngày nhập đến ngày hết (hoặc hôm nay nếu chưa hết), tối thiểu 1
function lineDays(batchDate: string, soldOutDate: string | null, today: string): number {
  const end = soldOutDate ?? today
  return end < batchDate ? 1 : Math.max(1, daysInclusive(batchDate, end))
}

// Nhu cầu từng loại, tính theo tốc độ bán hết thay vì số lượng bán (mỗi loại nhập số lượng khác nhau)
export type DemandRow = {
  productId: string
  rank: number
  qty: number
  sold: number
  // Tỷ lệ đã bán / đã nhập (0..1)
  rate: number
  // Số hũ bán mỗi ngày (tổng bán ÷ tổng số ngày bán)
  perDay: number
  // Trung bình số ngày bán hết của các lô đã hết; null nếu chưa lô nào hết
  daysToSellOut: number | null
  soldOut: boolean
  // Tốc độ bán hết: phần của lô bán được mỗi ngày (tỷ lệ ÷ số ngày), trung bình các lô
  speed: number
  share: number
  suggested: number
}

// Hệ số cộng thêm cho loại đã hết hàng: số đã bán chỉ là mức thấp nhất của nhu cầu thật
const SOLD_OUT_BOOST = 1.25

export function demandStats(batches: BatchStat[], productIds: string[], today: string, basis: SuggestionBasis, plannedTotal: number): DemandRow[] | null {
  const source = basis === 'last' ? batches.slice(-1) : batches
  const raw = productIds.map((productId, order) => {
    const lines = source.flatMap((b) => b.lines.filter((l) => l.productId === productId && l.qty > 0).map((l) => ({ b, l })))
    const qty = sum(lines.map((x) => x.l.qty))
    const sold = sum(lines.map((x) => x.l.sold))
    const days = lines.map((x) => lineDays(x.b.date, x.l.soldOutDate, today))
    const speed = lines.length ? sum(lines.map((x, i) => x.l.sold / x.l.qty / days[i])) / lines.length : 0
    const out = lines.filter((x) => x.l.soldOutDate !== null)
    return {
      productId,
      order,
      qty,
      sold,
      rate: qty > 0 ? sold / qty : 0,
      perDay: sum(days) > 0 ? sold / sum(days) : 0,
      daysToSellOut: out.length ? sum(out.map((x) => days[lines.indexOf(x)])) / out.length : null,
      soldOut: out.length > 0,
      speed,
    }
  })
  const weights = raw.map((r) => r.perDay * (r.soldOut ? SOLD_OUT_BOOST : 1))
  const totalWeight = sum(weights)
  if (!(totalWeight > 0)) return null
  return raw
    .map((r, i) => ({ ...r, share: weights[i] / totalWeight, suggested: Math.round(plannedTotal * (weights[i] / totalWeight)) }))
    .sort((a, b) => b.speed - a.speed || b.perDay - a.perDay || a.order - b.order)
    .map(({ order: _order, ...r }, index) => ({ ...r, rank: index + 1 }))
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
