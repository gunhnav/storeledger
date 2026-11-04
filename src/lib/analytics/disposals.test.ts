import { describe, expect, it } from 'vitest'
import { batchStats } from './batches'
import { stockRows } from './overview'
import type { AnalyticsInput } from './types'

// Một đợt: 10 hũ Truyền thống giá vốn 9.000; 6 hũ ra quán; bán 3 hũ ở quán
function input(): AnalyticsInput {
  return {
    products: [{ id: 'tt', name: 'Truyền thống', threshold: 1, tracksStock: true }],
    purchases: [{ id: 'p1', date: '2026-11-01', note: null }],
    batchLines: [{ id: 'l1', purchaseId: 'p1', date: '2026-11-01', productId: 'tt', qty: 10, unitCost: 9000 }],
    sales: [{ date: '2026-11-02', productId: 'tt', qty: 3, unitPrice: 12000, commissionRate: 0 }],
    transfers: [{ date: '2026-11-01', productId: 'tt', qty: 6 }],
    expenses: [{ date: '2026-11-01', amount: 5000 }],
    prices: [{ productId: 'tt', effectiveFrom: '2026-01-01', salePrice: 12000 }],
  }
}
const alloc = [{ batchLineId: 'l1', purchaseId: 'p1', productId: 'tt', date: '2026-11-02', qty: 3, revenue: 36000, cost: 27000 }]
const price = new Map([['tt', 12000]])

describe('hàng huỷ', () => {
  it('trừ tồn đúng nơi để', () => {
    const data = input()
    data.disposals = [
      { date: '2026-11-03', productId: 'tt', qty: 1, location: 'shop' },
      { date: '2026-11-03', productId: 'tt', qty: 2, location: 'home' },
    ]
    const row = stockRows(data)[0]
    expect(row.shop).toBe(6 - 3 - 1)
    expect(row.home).toBe(10 - 6 - 2)
  })

  it('theo đợt nhập: số huỷ, giá trị huỷ, còn tồn và lợi nhuận ròng', () => {
    const data = input()
    data.disposals = [{ date: '2026-11-03', productId: 'tt', qty: 2, location: 'shop', lines: [{ batchLineId: 'l1', qty: 2, unitCost: 9000 }] }]
    const { batches, totals } = batchStats(data, alloc, price, '2026-11-04')
    expect(batches[0].disposed).toBe(2)
    expect(batches[0].disposedValue).toBe(18000)
    expect(batches[0].remaining).toBe(10 - 3 - 2)
    expect(batches[0].remainingValue).toBe(5 * 9000)
    expect(batches[0].projectedProfit).toBe(8 * 12000 - 90000)
    expect(totals.disposedValue).toBe(18000)
    expect(totals.netProfit).toBe(36000 - 27000 - 5000 - 18000)
  })

  it('lô về 0 vì huỷ thì có ngày hết là ngày huỷ', () => {
    const data = input()
    data.disposals = [{ date: '2026-11-05', productId: 'tt', qty: 7, location: 'home', lines: [{ batchLineId: 'l1', qty: 7, unitCost: 9000 }] }]
    const { batches } = batchStats(data, alloc, price, '2026-11-05')
    expect(batches[0].remaining).toBe(0)
    expect(batches[0].lines[0].soldOutDate).toBe('2026-11-05')
  })

  it('không có hàng huỷ thì giữ nguyên số cũ', () => {
    const { batches, totals } = batchStats(input(), alloc, price, '2026-11-04')
    expect(batches[0].disposed).toBe(0)
    expect(batches[0].remaining).toBe(7)
    expect(totals.netProfit).toBe(36000 - 27000 - 5000)
  })
})

describe('thanh toán đợt nhập', () => {
  it('đưa ngày thanh toán ra theo đợt', () => {
    const data = input()
    expect(batchStats(data, alloc, price, '2026-11-04').batches[0].paidOn).toBeNull()
    data.purchases[0].paidOn = '2026-11-03'
    expect(batchStats(data, alloc, price, '2026-11-04').batches[0].paidOn).toBe('2026-11-03')
  })
})
