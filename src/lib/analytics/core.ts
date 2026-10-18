import { addDays } from '../format'
import type { ABatchLine, AnalyticsInput, APriceRow, ASaleLine } from './types'

// Giá bán loại `productId` vào ngày `date`: dòng có ngày áp dụng lớn nhất mà ≤ date,
// không có thì dùng `basePrice` (giá bán ban đầu)
export function priceOn(prices: APriceRow[], productId: string, date: string, basePrice = 0): number {
  let best: APriceRow | null = null
  for (const row of prices) {
    if (row.productId !== productId || row.effectiveFrom > date) continue
    if (!best || row.effectiveFrom > best.effectiveFrom) best = row
  }
  return best ? best.salePrice : basePrice
}

// Tiền thực thu của một dòng bán (trừ hoa hồng ShopeeFood, làm tròn như get_pnl)
export function saleRevenue(line: ASaleLine): number {
  const gross = line.qty * line.unitPrice
  return gross - Math.round(gross * line.commissionRate * 100) / 100
}

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

// Danh sách ngày liên tiếp từ `from` đến `to` (gồm cả hai đầu)
export function dayRange(from: string, to: string): string[] {
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  return days
}

// Số ngày tính cả hai đầu (from ≤ to)
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
}

// Thứ tự đợt nhập: theo ngày, cùng ngày thì theo thứ tự trong danh sách
export function orderedBatchLines(input: AnalyticsInput): ABatchLine[] {
  const order = new Map(input.purchases.map((p, i) => [p.id, i]))
  return [...input.batchLines].sort(
    (a, b) => a.date.localeCompare(b.date) || (order.get(a.purchaseId) ?? 0) - (order.get(b.purchaseId) ?? 0),
  )
}

// Một phần của dòng bán được gán cho một dòng đợt nhập (FIFO)
export type Allocation = {
  batchLineId: string
  purchaseId: string
  productId: string
  date: string
  qty: number
  revenue: number
  cost: number
}

export type FifoResult = {
  allocations: Allocation[]
  // Số hũ bán vượt quá tổng đã nhập (không gán được cho đợt nào) theo loại
  unallocated: Map<string, number>
}

// FIFO theo từng loại, giống Excel: hũ bán được gán cho đợt cũ trước, đợt mới sau.
// Với đợt k: đã bán = clamp(tổng bán − IK1, 0, số hũ đợt k), IK1 = tổng hũ các đợt trước k.
export function allocateFifo(input: AnalyticsInput): FifoResult {
  const lines = orderedBatchLines(input)
  const sales = [...input.sales].sort((a, b) => a.date.localeCompare(b.date))
  const allocations: Allocation[] = []
  const unallocated = new Map<string, number>()

  // Hàng đợi các dòng đợt nhập còn hũ, theo loại
  const queues = new Map<string, { line: ABatchLine; left: number }[]>()
  for (const line of lines) {
    if (line.qty <= 0) continue
    const queue = queues.get(line.productId) ?? []
    queue.push({ line, left: line.qty })
    queues.set(line.productId, queue)
  }

  for (const sale of sales) {
    if (sale.qty <= 0) continue
    const unitRevenue = saleRevenue(sale) / sale.qty
    let need = sale.qty
    const queue = queues.get(sale.productId) ?? []
    while (need > 0 && queue.length > 0) {
      const head = queue[0]
      const take = Math.min(head.left, need)
      allocations.push({
        batchLineId: head.line.id,
        purchaseId: head.line.purchaseId,
        productId: sale.productId,
        date: sale.date,
        qty: take,
        revenue: take * unitRevenue,
        cost: take * head.line.unitCost,
      })
      head.left -= take
      need -= take
      if (head.left === 0) queue.shift()
    }
    if (need > 0) unallocated.set(sale.productId, (unallocated.get(sale.productId) ?? 0) + need)
  }
  return { allocations, unallocated }
}

// Kết quả của một ngày (mục B)
export type DailyResult = {
  day: string
  revenue: number
  cogs: number
  expenses: number
  grossProfit: number
  netProfit: number
  purchaseCost: number
  // Tồn theo loại, cuối ngày
  shopStock: Record<string, number>
  homeStock: Record<string, number>
  cumInvested: number
  cumRevenue: number
  cashFlow: number
  breakEven: boolean
}

// Kết quả theo từng ngày trong [from, to]; các cột luỹ kế tính từ đầu dữ liệu
export function dailyResults(input: AnalyticsInput, fifo: FifoResult, from: string, to: string): DailyResult[] {
  const stockProducts = input.products.filter((p) => p.tracksStock)
  const byDay = <T,>(items: T[], date: (x: T) => string, value: (x: T) => number) => {
    const map = new Map<string, number>()
    for (const item of items) map.set(date(item), (map.get(date(item)) ?? 0) + value(item))
    return map
  }
  const revenueByDay = byDay(input.sales, (s) => s.date, saleRevenue)
  const cogsByDay = byDay(fifo.allocations, (a) => a.date, (a) => a.cost)
  const expenseByDay = byDay(input.expenses, (e) => e.date, (e) => e.amount)
  const purchaseByDay = byDay(input.batchLines, (b) => b.date, (b) => b.qty * b.unitCost)

  const allDates = [
    ...input.sales.map((s) => s.date),
    ...input.expenses.map((e) => e.date),
    ...input.batchLines.map((b) => b.date),
    ...input.transfers.map((t) => t.date),
  ]
  const start = allDates.reduce((min, d) => (d < min ? d : min), from)

  let cumInvested = 0
  let cumRevenue = 0
  let reachedBreakEven = false
  const purchased: Record<string, number> = {}
  const moved: Record<string, number> = {}
  const sold: Record<string, number> = {}
  for (const p of stockProducts) {
    purchased[p.id] = 0
    moved[p.id] = 0
    sold[p.id] = 0
  }

  const results: DailyResult[] = []
  for (const day of dayRange(start, to)) {
    for (const b of input.batchLines) if (b.date === day && b.productId in purchased) purchased[b.productId] += b.qty
    for (const t of input.transfers) if (t.date === day && t.productId in moved) moved[t.productId] += t.qty
    for (const s of input.sales) if (s.date === day && s.productId in sold) sold[s.productId] += s.qty

    const revenue = revenueByDay.get(day) ?? 0
    const cogs = cogsByDay.get(day) ?? 0
    const expenses = expenseByDay.get(day) ?? 0
    const purchaseCost = purchaseByDay.get(day) ?? 0
    cumInvested += purchaseCost + expenses
    cumRevenue += revenue
    if (!reachedBreakEven && cumInvested > 0 && cumRevenue >= cumInvested) reachedBreakEven = true

    if (day < from) continue
    const shopStock: Record<string, number> = {}
    const homeStock: Record<string, number> = {}
    for (const p of stockProducts) {
      shopStock[p.id] = moved[p.id] - sold[p.id]
      homeStock[p.id] = purchased[p.id] - moved[p.id]
    }
    results.push({
      day,
      revenue,
      cogs,
      expenses,
      grossProfit: revenue - cogs,
      netProfit: revenue - cogs - expenses,
      purchaseCost,
      shopStock,
      homeStock,
      cumInvested,
      cumRevenue,
      cashFlow: cumRevenue - cumInvested,
      breakEven: reachedBreakEven,
    })
  }
  return results
}
