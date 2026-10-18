import { describe, expect, it } from 'vitest'
import { allocateFifo, dailyResults, priceOn } from './core'
import { batchStats } from './batches'
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
