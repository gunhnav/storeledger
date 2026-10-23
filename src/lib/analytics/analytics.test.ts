import { describe, expect, it } from 'vitest'
import { allocateFifo, dailyResults, priceOn } from './core'
import { batchStats } from './batches'
import { demandStats, salesPeriods, sellThrough, suggestNextBatch } from './bestSellers'
import { financialSummary, productResults, stockAlerts, stockRows } from './overview'
import type { AnalyticsInput, ASaleLine } from './types'

// Dữ liệu mẫu từ Google Sheet (chỉ dùng trong test)
const NAMES = ['Truyền thống', 'Nếp cẩm', 'Matcha', 'Phô mai', 'Cacao']
const IDS = ['tt', 'nc', 'mt', 'pm', 'cc']
const BASE_PRICE = [12000, 15000, 15000, 15000, 15000]
const COST = [9000, 11000, 11000, 11000, 11000]

function sampleInput(extraPrices: AnalyticsInput['prices'] = []): AnalyticsInput {
  const prices = [
    ...IDS.map((id, i) => ({ productId: id, effectiveFrom: '2026-01-01', salePrice: BASE_PRICE[i] })),
    ...extraPrices,
  ]
  const sale = (date: string, qtys: number[]): ASaleLine[] =>
    qtys
      .map((qty, i) => ({ date, productId: IDS[i], qty, unitPrice: priceOn(prices, IDS[i], date), commissionRate: 0 }))
      .filter((l) => l.qty > 0)
  const move = (date: string, qtys: number[]) =>
    qtys.map((qty, i) => ({ date, productId: IDS[i], qty })).filter((t) => t.qty > 0)
  return {
    products: IDS.map((id, i) => ({ id, name: NAMES[i], threshold: 3, tracksStock: true })),
    purchases: [{ id: 'b1', date: '2026-10-15', note: null }],
    batchLines: [50, 20, 10, 10, 10].map((qty, i) => ({
      id: `b1-${IDS[i]}`,
      purchaseId: 'b1',
      date: '2026-10-15',
      productId: IDS[i],
      qty,
      unitCost: COST[i],
    })),
    sales: [...sale('2026-10-15', [1, 0, 1, 0, 0]), ...sale('2026-10-16', [1, 7, 4, 3, 4])],
    transfers: [...move('2026-10-15', [25, 10, 5, 5, 5]), ...move('2026-10-16', [0, 0, 3, 3, 3])],
    expenses: [
      { date: '2026-10-15', amount: 44000 },
      { date: '2026-10-15', amount: 84480 },
    ],
    prices,
  }
}

const daily = (input: AnalyticsInput) => {
  const fifo = allocateFifo(input)
  const days = dailyResults(input, fifo, '2026-10-15', '2026-10-16')
  return { fifo, d15: days[0], d16: days[1] }
}

describe('kết quả theo ngày (mục B)', () => {
  it('doanh thu và giá vốn theo ngày, luỹ kế', () => {
    const { d15, d16 } = daily(sampleInput())
    expect(d15.revenue).toBe(27000)
    expect(d16.revenue).toBe(282000)
    expect(d16.cumRevenue).toBe(309000)
    expect(d15.cogs).toBe(20000)
    expect(d16.cogs).toBe(207000)
  })

  it('vốn đã chi luỹ kế 15/10 = tiền nhập + chi phí', () => {
    expect(daily(sampleInput()).d15.cumInvested).toBe(1128480)
  })

  it('còn ở nhà / còn tại quầy cuối ngày 16/10', () => {
    const { d16 } = daily(sampleInput())
    expect(IDS.map((id) => d16.homeStock[id])).toEqual([25, 10, 2, 2, 2])
    expect(IDS.map((id) => d16.shopStock[id])).toEqual([23, 3, 3, 5, 4])
  })

  it('đổi giá không làm doanh thu cũ bị tính lại', () => {
    const { d15, d16 } = daily(sampleInput([{ productId: 'tt', effectiveFrom: '2026-10-16', salePrice: 13000 }]))
    expect(d15.revenue).toBe(27000)
    expect(d16.revenue).toBe(283000)
  })
})

describe('thống kê theo đợt (phần 1)', () => {
  const price = new Map(IDS.map((id, i) => [id, BASE_PRICE[i]]))

  it('đợt 1 tính đến 16/10', () => {
    const input = sampleInput()
    const { batches, totals } = batchStats(input, allocateFifo(input).allocations, price, '2026-10-16')
    const b1 = batches[0]
    expect(b1.cost).toBe(1000000)
    expect(b1.revenue).toBe(309000)
    expect(b1.sold).toBe(21)
    // Prompt ghi 59 nhưng 100 hũ nhập − 21 hũ bán = 79 (khớp tồn nhà 41 + quầy 38)
    expect(b1.remaining).toBe(79)
    expect(b1.recoveryPct).toBeCloseTo(0.309, 3)
    expect(b1.recovered).toBe(false)
    expect(b1.breakEvenDate).toBeNull()
    expect(b1.soldOutDate).toBeNull()
    expect(b1.sellingDay).toBe(2)
    expect(b1.grossProfit).toBe(309000 - 227000)
    expect(totals.expenses).toBe(128480)
    expect(totals.netProfit).toBe(309000 - 227000 - 128480)
  })

  it('đợt 2 chỉ 1 loại: vốn đúng, không NaN', () => {
    const input = sampleInput()
    input.purchases.push({ id: 'b2', date: '2026-10-16', note: null })
    input.batchLines.push({ id: 'b2-tt', purchaseId: 'b2', date: '2026-10-16', productId: 'tt', qty: 10, unitCost: 10000 })
    const { batches } = batchStats(input, allocateFifo(input).allocations, price, '2026-10-16')
    const b2 = batches[1]
    expect(b2.cost).toBe(100000)
    expect(b2.lines).toHaveLength(1)
    for (const value of [b2.revenue, b2.cogs, b2.sold, b2.remaining, b2.remainingValue, b2.projectedProfit]) {
      expect(Number.isNaN(value)).toBe(false)
    }
    expect(b2.sold).toBe(0)
    expect(b2.remaining).toBe(10)
  })

  it('lô bán hết có ngày hết, loại hết trước', () => {
    const input = sampleInput()
    // Bán thêm 4 Nếp cẩm... cho đủ 20 hũ của lô Nếp cẩm
    input.sales.push({ date: '2026-10-17', productId: 'nc', qty: 13, unitPrice: 15000, commissionRate: 0 })
    const { batches } = batchStats(input, allocateFifo(input).allocations, price, '2026-10-17')
    const nc = batches[0].lines.find((l) => l.productId === 'nc')!
    expect(nc.remaining).toBe(0)
    expect(nc.soldOutDate).toBe('2026-10-17')
    expect(batches[0].firstOutProductId).toBe('nc')
    expect(batches[0].lastOutProductId).toBeNull()
    expect(batches[0].soldOutDate).toBeNull()
  })
})

describe('bán chạy & gợi ý nhập (phần 2)', () => {
  const price = new Map(IDS.map((id, i) => [id, BASE_PRICE[i]]))
  const withBatch2 = () => {
    const input = sampleInput()
    input.purchases.push({ id: 'b2', date: '2026-10-16', note: null })
    input.batchLines.push({ id: 'b2-tt', purchaseId: 'b2', date: '2026-10-16', productId: 'tt', qty: 10, unitCost: 10000 })
    return input
  }

  it('kỳ bán của đợt 1 = 15/10 đến 15/10 khi đợt 2 nhập 16/10', () => {
    const periods = salesPeriods(withBatch2(), '2026-10-16')
    expect(periods[0]).toMatchObject({ from: '2026-10-15', to: '2026-10-15', total: 2 })
    expect(periods[1]).toMatchObject({ from: '2026-10-16', to: '2026-10-16', total: 19 })
    expect(periods[1].topProductId).toBe('nc')
    expect(periods[1].topQty).toBe(7)
  })

  it('gợi ý theo tất cả các đợt: tỷ trọng [2:7:5:3:4]/21', () => {
    const periods = salesPeriods(sampleInput(), '2026-10-16')
    const rows = suggestNextBatch(periods, IDS, 100, 'all')!
    const byId = Object.fromEntries(rows.map((r) => [r.productId, r.suggested]))
    expect(IDS.map((id) => byId[id])).toEqual([2, 7, 5, 3, 4].map((n) => Math.round((100 * n) / 21)))
    expect(rows[0]).toMatchObject({ productId: 'nc', rank: 1 })
  })

  it('chưa có số liệu bán thì không gợi ý', () => {
    const input = sampleInput()
    input.sales = []
    expect(suggestNextBatch(salesPeriods(input, '2026-10-16'), IDS, 100, 'all')).toBeNull()
  })

  it('tỷ lệ bán hết từng loại trong đợt và loại bán hết nhanh nhất', () => {
    const input = sampleInput()
    const { batches } = batchStats(input, allocateFifo(input).allocations, price, '2026-10-16')
    const [st] = sellThrough(batches)
    expect(st.rates.nc).toBeCloseTo(7 / 20)
    expect(st.rates.mt).toBeCloseTo(5 / 10)
    expect(st.fastestProductId).toBe('mt')
  })
})

describe('tổng quan & banner (phần 3)', () => {
  const price = new Map(IDS.map((id, i) => [id, BASE_PRICE[i]]))

  it('tồn ở nhà / tại quầy và trạng thái', () => {
    const rows = stockRows(sampleInput())
    expect(rows.map((r) => r.home)).toEqual([25, 10, 2, 2, 2])
    expect(rows.map((r) => r.shop)).toEqual([23, 3, 3, 5, 4])
    expect(rows.map((r) => r.shopStatus)).toEqual(['ok', 'low', 'low', 'ok', 'ok'])
    const alerts = stockAlerts(rows)
    expect(alerts.level).toBe('orange')
    expect(alerts.low).toEqual(['Nếp cẩm', 'Matcha'])
  })

  it('bán hết tại quầy → banner đỏ; bán vượt số mang ra → KIỂM TRA, không crash', () => {
    const input = sampleInput()
    input.sales.push({ date: '2026-10-16', productId: 'mt', qty: 3, unitPrice: 15000, commissionRate: 0 })
    let rows = stockRows(input)
    expect(rows.find((r) => r.productId === 'mt')!.shopStatus).toBe('out')
    expect(stockAlerts(rows)).toMatchObject({ level: 'red', out: ['Matcha'] })
    input.sales.push({ date: '2026-10-16', productId: 'mt', qty: 2, unitPrice: 15000, commissionRate: 0 })
    rows = stockRows(input)
    expect(rows.find((r) => r.productId === 'mt')!.shopStatus).toBe('check')
    // Mang ra nhiều hơn đã nhập
    input.transfers.push({ date: '2026-10-16', productId: 'pm', qty: 50 })
    expect(stockRows(input).find((r) => r.productId === 'pm')!.homeStatus).toBe('check')
    expect(stockRows(input).find((r) => r.productId === 'pm')!.shopStatus).toBe('check')
  })

  it('phân phối cho công ty: trừ ở nhà, không cộng vào tồn quán; bán kênh Công ty trừ phần công ty', () => {
    const input = sampleInput()
    input.transfers.push({ date: '2026-10-17', productId: 'tt', qty: 8, destination: 'company' })
    input.sales.push({ date: '2026-10-17', productId: 'tt', qty: 6, unitPrice: 14000, commissionRate: 0, channel: 'company' })
    const tt = stockRows(input).find((r) => r.productId === 'tt')!
    expect(tt.home).toBe(17)
    expect(tt.shop).toBe(23)
    expect(tt.company).toBe(2)
    expect(tt.movedShop).toBe(25)
    expect(tt.moved).toBe(33)
    expect(tt.sold).toBe(2)
  })

  it('chưa mang ra quầy', () => {
    const input = sampleInput()
    input.transfers = input.transfers.filter((t) => t.productId !== 'cc')
    input.sales = input.sales.filter((s) => s.productId !== 'cc')
    expect(stockRows(input).find((r) => r.productId === 'cc')!.shopStatus).toBe('not_moved')
  })

  it('kết quả theo loại', () => {
    const input = sampleInput()
    const results = productResults(input, allocateFifo(input).allocations, price)
    const nc = results.find((r) => r.productId === 'nc')!
    expect(nc).toMatchObject({ sold: 7, revenue: 105000, cogs: 77000, grossProfit: 28000, avgCost: 11000, profitPerUnit: 4000 })
  })

  it('lãi lỗ, dòng tiền và dự báo hoà vốn', () => {
    const input = sampleInput()
    const s = financialSummary(input, allocateFifo(input).allocations, price)
    expect(s.revenue).toBe(309000)
    expect(s.cogs).toBe(227000)
    expect(s.expenses).toBe(128480)
    expect(s.netProfit).toBe(309000 - 227000 - 128480)
    expect(s.totalSpent).toBe(1128480)
    expect(s.cashFlow).toBe(309000 - 1128480)
    expect(s.remainingToRecover).toBe(1128480 - 309000)
    expect(s.stockValue).toBe(773000)
    expect(s.revenueIfSellAll).toBe(309000 + 48 * 12000 + 31 * 15000)
    expect(s.finalProjected).toBe(309000 + 48 * 12000 + 31 * 15000 - 1128480)
    expect(s.avgDailyRevenue).toBe(154500)
    expect(s.breakEvenDate).toBeNull()
    // 16/10 + ceil(819.480 / 154.500) = 16/10 + 6 ngày
    expect(s.projectedBreakEven).toBe('2026-10-22')
  })
})

describe('gợi ý theo tốc độ bán hết (không theo số lượng)', () => {
  // Loại A nhập 50, bán 10 trong 5 ngày (chưa hết); loại B nhập 5, hết sạch ngay ngày đầu
  const input: AnalyticsInput = {
    products: [
      { id: 'a', name: 'A', threshold: 3, tracksStock: true },
      { id: 'b', name: 'B', threshold: 3, tracksStock: true },
    ],
    purchases: [{ id: 'p1', date: '2026-10-10', note: null }],
    batchLines: [
      { id: 'la', purchaseId: 'p1', date: '2026-10-10', productId: 'a', qty: 50, unitCost: 1000 },
      { id: 'lb', purchaseId: 'p1', date: '2026-10-10', productId: 'b', qty: 5, unitCost: 1000 },
    ],
    sales: [
      { date: '2026-10-10', productId: 'b', qty: 5, unitPrice: 2000, commissionRate: 0 },
      { date: '2026-10-12', productId: 'a', qty: 10, unitPrice: 2000, commissionRate: 0 },
    ],
    transfers: [],
    expenses: [],
    prices: [],
  }
  const { batches } = batchStats(input, allocateFifo(input).allocations, new Map(), '2026-10-14')

  it('loại hết trước xếp hạng cao hơn dù nhập ít hơn', () => {
    const rows = demandStats(batches, ['a', 'b'], '2026-10-14', 'all', 100)!
    expect(rows[0]).toMatchObject({ productId: 'b', rank: 1, soldOut: true, daysToSellOut: 1 })
    expect(rows[1]).toMatchObject({ productId: 'a', rank: 2, soldOut: false })
    // A: 10 hũ / 5 ngày = 2 mỗi ngày; B: 5 hũ / 1 ngày = 5 mỗi ngày (cộng 25% vì đã hết)
    expect(rows[1].perDay).toBeCloseTo(2)
    expect(rows[0].perDay).toBeCloseTo(5)
    expect(rows[0].suggested + rows[1].suggested).toBeGreaterThanOrEqual(99)
    expect(rows[0].suggested).toBeGreaterThan(rows[1].suggested)
  })

  it('loại bán hết nhanh nhất của đợt là B', () => {
    const [st] = sellThrough(batches, '2026-10-14')
    expect(st.fastestProductId).toBe('b')
  })

  it('chưa bán gì thì không gợi ý', () => {
    const empty = { ...input, sales: [] }
    const { batches: b2 } = batchStats(empty, allocateFifo(empty).allocations, new Map(), '2026-10-14')
    expect(demandStats(b2, ['a', 'b'], '2026-10-14', 'all', 100)).toBeNull()
  })
})
