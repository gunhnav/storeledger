import { daysInclusive, orderedBatchLines, sum, type Allocation } from './core'
import type { AnalyticsInput } from './types'

// Một loại trong một đợt (một lô)
export type BatchLineStat = {
  batchLineId: string
  productId: string
  qty: number
  cost: number
  sold: number
  // Số hũ huỷ vì không đủ chất lượng bán
  disposed: number
  remaining: number
  // Ngày lô về 0 (hũ cuối cùng bán hoặc huỷ); null = chưa hết
  soldOutDate: string | null
}

export type BatchStat = {
  purchaseId: string
  date: string
  note: string | null
  // Ngày đã thanh toán đợt nhập; null = chưa thanh toán
  paidOn: string | null
  lines: BatchLineStat[]
  totalQty: number
  cost: number
  sold: number
  // Tỷ lệ 0..1 (null khi đợt không có hũ nào)
  soldPct: number | null
  revenue: number
  cogs: number
  grossProfit: number
  disposed: number
  // Giá vốn của phần hàng huỷ (lỗ, chưa nằm trong giá vốn hàng bán)
  disposedValue: number
  remaining: number
  remainingValue: number
  recoveryPct: number | null
  recovered: boolean
  breakEvenDate: string | null
  // Lãi/lỗ dự kiến nếu bán hết theo giá bán hiện hành
  projectedProfit: number
  // Ngày hết cả đợt (chỉ khi mọi lô đã hết)
  soldOutDate: string | null
  daysToSellOut: number | null
  // Ngày thứ N đang bán (khi chưa hết)
  sellingDay: number | null
  firstOutProductId: string | null
  lastOutProductId: string | null
}

export type BatchTotals = {
  totalQty: number
  cost: number
  sold: number
  revenue: number
  cogs: number
  grossProfit: number
  disposed: number
  disposedValue: number
  remaining: number
  remainingValue: number
  expenses: number
  // Lãi gộp − chi phí − giá trị hàng huỷ
  netProfit: number
}

// Thống kê theo đợt nhập (chỉ món đếm tồn). `allocations`: phần bán đã gán FIFO cho từng lô
// (từ sale_item_cost_lines, hoặc allocateFifo khi test). `currentPrice`: giá bán hiện hành theo loại.
export function batchStats(
  input: AnalyticsInput,
  allocations: Allocation[],
  currentPrice: Map<string, number>,
  today: string,
): { batches: BatchStat[]; totals: BatchTotals } {
  const stocked = new Set(input.products.filter((p) => p.tracksStock).map((p) => p.id))
  const lines = orderedBatchLines(input).filter((l) => stocked.has(l.productId) && l.qty > 0)
  const byLine = new Map<string, Allocation[]>()
  for (const a of allocations) {
    const list = byLine.get(a.batchLineId) ?? []
    list.push(a)
    byLine.set(a.batchLineId, list)
  }
  // Phần hàng huỷ của từng lô (kèm ngày huỷ, giá vốn lô)
  const disposedByLine = new Map<string, { date: string; qty: number; cost: number }[]>()
  for (const d of input.disposals ?? []) {
    for (const l of d.lines ?? []) {
      const list = disposedByLine.get(l.batchLineId) ?? []
      list.push({ date: d.date, qty: l.qty, cost: l.qty * l.unitCost })
      disposedByLine.set(l.batchLineId, list)
    }
  }

  const purchaseOrder = [...input.purchases].sort((a, b) => a.date.localeCompare(b.date))
  const batches: BatchStat[] = []
  for (const purchase of purchaseOrder) {
    const own = lines.filter((l) => l.purchaseId === purchase.id)
    if (own.length === 0) continue
    const ownAllocations: Allocation[] = []
    const lineStats: BatchLineStat[] = own.map((line) => {
      const allocs = [...(byLine.get(line.id) ?? [])].sort((a, b) => a.date.localeCompare(b.date))
      ownAllocations.push(...allocs)
      const disposals = disposedByLine.get(line.id) ?? []
      const sold = Math.min(sum(allocs.map((a) => a.qty)), line.qty)
      const disposed = Math.min(sum(disposals.map((d) => d.qty)), line.qty - sold)
      const remaining = line.qty - sold - disposed
      // Ngày hết = ngày của phần bán / huỷ làm lô về 0, không sớm hơn ngày nhập
      let soldOutDate: string | null = null
      if (remaining === 0) {
        let running = 0
        const events = [...allocs, ...disposals].sort((x, y) => x.date.localeCompare(y.date))
        for (const a of events) {
          running += a.qty
          if (running >= line.qty) {
            soldOutDate = a.date < line.date ? line.date : a.date
            break
          }
        }
      }
      return { batchLineId: line.id, productId: line.productId, qty: line.qty, cost: line.qty * line.unitCost, sold, disposed, remaining, soldOutDate }
    })

    const totalQty = sum(lineStats.map((l) => l.qty))
    const cost = sum(lineStats.map((l) => l.cost))
    const sold = sum(lineStats.map((l) => l.sold))
    const revenue = sum(ownAllocations.map((a) => a.revenue))
    const cogs = sum(ownAllocations.map((a) => a.cost))
    const disposed = sum(lineStats.map((l) => l.disposed))
    const disposedValue = sum(own.map((line) => sum((disposedByLine.get(line.id) ?? []).map((d) => d.cost))))
    const remaining = totalQty - sold - disposed
    const remainingValue = sum(own.map((line, i) => lineStats[i].remaining * line.unitCost))

    // Ngày hoà vốn của đợt: doanh thu luỹ kế riêng của đợt ≥ vốn đợt
    let breakEvenDate: string | null = null
    if (cost > 0) {
      let running = 0
      for (const a of [...ownAllocations].sort((x, y) => x.date.localeCompare(y.date))) {
        running += a.revenue
        if (running >= cost) {
          breakEvenDate = a.date
          break
        }
      }
    }

    const outLines = lineStats.filter((l) => l.soldOutDate !== null)
    const allOut = outLines.length === lineStats.length
    const soldOutDate = allOut ? outLines.map((l) => l.soldOutDate!).sort().at(-1)! : null
    const byOutDate = [...outLines].sort((a, b) => a.soldOutDate!.localeCompare(b.soldOutDate!))

    batches.push({
      purchaseId: purchase.id,
      date: purchase.date,
      note: purchase.note,
      paidOn: purchase.paidOn ?? null,
      lines: lineStats,
      totalQty,
      cost,
      sold,
      soldPct: totalQty > 0 ? sold / totalQty : null,
      revenue,
      cogs,
      grossProfit: revenue - cogs,
      disposed,
      disposedValue,
      remaining,
      remainingValue,
      recoveryPct: cost > 0 ? revenue / cost : null,
      recovered: cost > 0 && revenue >= cost,
      breakEvenDate,
      // Hũ đã huỷ không bán được nữa
      projectedProfit: sum(lineStats.map((l) => (l.qty - l.disposed) * (currentPrice.get(l.productId) ?? 0))) - cost,
      soldOutDate,
      daysToSellOut: soldOutDate ? daysInclusive(purchase.date, soldOutDate) : null,
      sellingDay: soldOutDate ? null : today >= purchase.date ? daysInclusive(purchase.date, today) : null,
      firstOutProductId: byOutDate[0]?.productId ?? null,
      lastOutProductId: byOutDate.length >= 2 ? byOutDate.at(-1)!.productId : null,
    })
  }

  // Chi phí cùng khoảng thời gian: từ ngày nhập đợt đầu tiên đến hôm nay
  const first = batches[0]?.date
  const expenses = first ? sum(input.expenses.filter((e) => e.date >= first && e.date <= today).map((e) => e.amount)) : 0
  const pick = (
    key: keyof Pick<BatchStat, 'totalQty' | 'cost' | 'sold' | 'revenue' | 'cogs' | 'grossProfit' | 'disposed' | 'disposedValue' | 'remaining' | 'remainingValue'>,
  ) =>
    sum(batches.map((b) => b[key]))
  const grossProfit = pick('grossProfit')
  const disposedValue = pick('disposedValue')
  return {
    batches,
    totals: {
      totalQty: pick('totalQty'),
      cost: pick('cost'),
      sold: pick('sold'),
      revenue: pick('revenue'),
      cogs: pick('cogs'),
      grossProfit,
      disposed: pick('disposed'),
      disposedValue,
      remaining: pick('remaining'),
      remainingValue: pick('remainingValue'),
      expenses,
      netProfit: grossProfit - expenses - disposedValue,
    },
  }
}
