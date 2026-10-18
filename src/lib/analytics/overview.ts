import { addDays } from '../format'
import { daysInclusive, saleRevenue, sum, type Allocation } from './core'
import type { AnalyticsInput } from './types'

// Trạng thái tồn: chưa mang ra / hết / sắp hết / ổn / KIỂM TRA (số liệu vô lý)
export type StockStatus = 'not_moved' | 'out' | 'low' | 'ok' | 'check'

// Tồn tại quầy. Dùng chung cho admin và nhân viên (chỉ cần số lượng, không cần giá).
export function shopStatusOf(shop: number, everMoved: boolean, threshold: number): StockStatus {
  if (shop < 0) return 'check'
  if (!everMoved) return 'not_moved'
  if (shop === 0) return 'out'
  if (shop <= threshold) return 'low'
  return 'ok'
}

export function homeStatusOf(home: number, threshold: number): StockStatus {
  if (home < 0) return 'check'
  if (home === 0) return 'out'
  if (home <= threshold) return 'low'
  return 'ok'
}

export type StockRow = {
  productId: string
  name: string
  threshold: number
  purchased: number
  // Tổng đã mang khỏi nhà (ra quán + cho công ty)
  moved: number
  // Phần ra quán và bán tại quán / ShopeeFood
  movedShop: number
  sold: number
  home: number
  shop: number
  // Hàng đã phân phối cho công ty, chưa bán
  company: number
  homeStatus: StockStatus
  shopStatus: StockStatus
}

// Tồn ở nhà / tại quầy theo loại (chỉ món đếm tồn), tính từ tổng nhập − mang ra − bán
export function stockRows(input: AnalyticsInput): StockRow[] {
  return input.products
    .filter((p) => p.tracksStock)
    .map((p) => {
      const purchased = sum(input.batchLines.filter((b) => b.productId === p.id).map((b) => b.qty))
      const transfers = input.transfers.filter((t) => t.productId === p.id)
      const sales = input.sales.filter((s) => s.productId === p.id)
      const isCompany = (x: { destination?: string; channel?: string }) => x.destination === 'company' || x.channel === 'company'
      const moved = sum(transfers.map((t) => t.qty))
      const movedShop = sum(transfers.filter((t) => !isCompany(t)).map((t) => t.qty))
      const sold = sum(sales.filter((s) => !isCompany(s)).map((s) => s.qty))
      const company = moved - movedShop - sum(sales.filter(isCompany).map((s) => s.qty))
      const home = purchased - moved
      const shop = movedShop - sold
      // Mang ra nhiều hơn đã nhập: số liệu vô lý cho cả hai phía
      const movedTooMuch = moved > purchased
      return {
        productId: p.id,
        name: p.name,
        threshold: p.threshold,
        purchased,
        moved,
        movedShop,
        sold,
        home,
        shop,
        company,
        homeStatus: homeStatusOf(home, p.threshold),
        shopStatus: movedTooMuch ? 'check' : shopStatusOf(shop, movedShop > 0 || sold > 0, p.threshold),
      }
    })
}

export type StockAlerts = {
  level: 'red' | 'orange' | 'green'
  out: string[]
  low: string[]
  check: string[]
}

// Banner: đỏ khi có loại hết tại quầy (hoặc số liệu cần kiểm tra), cam khi sắp hết, xanh khi ổn
export function stockAlerts(rows: { name: string; shopStatus: StockStatus }[]): StockAlerts {
  const out = rows.filter((r) => r.shopStatus === 'out').map((r) => r.name)
  const low = rows.filter((r) => r.shopStatus === 'low').map((r) => r.name)
  const check = rows.filter((r) => r.shopStatus === 'check').map((r) => r.name)
  return { level: out.length || check.length ? 'red' : low.length ? 'orange' : 'green', out, low, check }
}

export type ProductResult = {
  productId: string
  name: string
  currentPrice: number
  sold: number
  revenue: number
  cogs: number
  grossProfit: number
  // Giá vốn bình quân / hũ bán và lãi / hũ (null khi chưa bán)
  avgCost: number | null
  profitPerUnit: number | null
}

// Kết quả theo loại. Giá vốn: phần gán lô (món đếm tồn) hoặc giá vốn chụp lúc bán (món không đếm tồn).
export function productResults(input: AnalyticsInput, allocations: Allocation[], currentPrice: Map<string, number>): ProductResult[] {
  return input.products
    .map((p) => {
      const lines = input.sales.filter((s) => s.productId === p.id)
      const sold = sum(lines.map((s) => s.qty))
      const revenue = sum(lines.map(saleRevenue))
      const cogs = p.tracksStock
        ? sum(allocations.filter((a) => a.productId === p.id).map((a) => a.cost))
        : sum(lines.map((s) => s.cost ?? 0))
      return {
        productId: p.id,
        name: p.name,
        currentPrice: currentPrice.get(p.id) ?? 0,
        sold,
        revenue,
        cogs,
        grossProfit: revenue - cogs,
        avgCost: sold > 0 ? cogs / sold : null,
        profitPerUnit: sold > 0 ? (revenue - cogs) / sold : null,
      }
    })
    .filter((r) => r.sold > 0 || input.products.find((p) => p.id === r.productId)?.tracksStock)
}

export type FinancialSummary = {
  revenue: number
  cogs: number
  grossProfit: number
  expenses: number
  netProfit: number
  margin: number | null
  totalPurchase: number
  totalSpent: number
  cashFlow: number
  remainingToRecover: number
  stockValue: number
  revenueIfSellAll: number
  finalProjected: number
  firstSale: string | null
  lastSale: string | null
  avgDailyRevenue: number | null
  // Ngày đạt hoà vốn thực tế (doanh thu luỹ kế ≥ vốn đã chi luỹ kế)
  breakEvenDate: string | null
  // Dự kiến ngày hoà vốn khi chưa hoà vốn
  projectedBreakEven: string | null
}

export function financialSummary(
  input: AnalyticsInput,
  allocations: Allocation[],
  currentPrice: Map<string, number>,
): FinancialSummary {
  const results = productResults(input, allocations, currentPrice)
  const revenue = sum(input.sales.map(saleRevenue))
  const cogs = sum(results.map((r) => r.cogs))
  const expenses = sum(input.expenses.map((e) => e.amount))
  const totalPurchase = sum(input.batchLines.map((b) => b.qty * b.unitCost))
  const totalSpent = totalPurchase + expenses

  // Tồn còn lại theo lô = số nhập − phần đã gán FIFO
  const allocatedByLine = new Map<string, number>()
  for (const a of allocations) allocatedByLine.set(a.batchLineId, (allocatedByLine.get(a.batchLineId) ?? 0) + a.qty)
  let stockValue = 0
  let stockSalesValue = 0
  for (const b of input.batchLines) {
    const left = Math.max(0, b.qty - (allocatedByLine.get(b.id) ?? 0))
    stockValue += left * b.unitCost
    stockSalesValue += left * (currentPrice.get(b.productId) ?? 0)
  }

  const saleDates = input.sales.map((s) => s.date).sort()
  const firstSale = saleDates[0] ?? null
  const lastSale = saleDates.at(-1) ?? null
  const avgDailyRevenue = firstSale && lastSale ? revenue / daysInclusive(firstSale, lastSale) : null

  // Ngày hoà vốn thực tế: duyệt các ngày có giao dịch theo thứ tự, cộng dồn
  const events = new Map<string, { spent: number; revenue: number }>()
  const add = (date: string, spent: number, rev: number) => {
    const e = events.get(date) ?? { spent: 0, revenue: 0 }
    e.spent += spent
    e.revenue += rev
    events.set(date, e)
  }
  for (const b of input.batchLines) add(b.date, b.qty * b.unitCost, 0)
  for (const e of input.expenses) add(e.date, e.amount, 0)
  for (const s of input.sales) add(s.date, 0, saleRevenue(s))
  let cumSpent = 0
  let cumRevenue = 0
  let breakEvenDate: string | null = null
  for (const date of [...events.keys()].sort()) {
    cumSpent += events.get(date)!.spent
    cumRevenue += events.get(date)!.revenue
    if (cumSpent > 0 && cumRevenue >= cumSpent) {
      breakEvenDate = date
      break
    }
  }

  const remainingToRecover = Math.max(0, totalSpent - revenue)
  const reached = totalSpent > 0 && revenue >= totalSpent
  const projectedBreakEven =
    !reached && lastSale && avgDailyRevenue && avgDailyRevenue > 0
      ? addDays(lastSale, Math.ceil(remainingToRecover / avgDailyRevenue))
      : null

  const grossProfit = revenue - cogs
  const netProfit = grossProfit - expenses
  return {
    revenue,
    cogs,
    grossProfit,
    expenses,
    netProfit,
    margin: revenue > 0 ? netProfit / revenue : null,
    totalPurchase,
    totalSpent,
    cashFlow: revenue - totalSpent,
    remainingToRecover,
    stockValue,
    revenueIfSellAll: revenue + stockSalesValue,
    finalProjected: revenue + stockSalesValue - totalSpent,
    firstSale,
    lastSale,
    avgDailyRevenue,
    breakEvenDate: reached ? breakEvenDate : null,
    projectedBreakEven,
  }
}
