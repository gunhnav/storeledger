import { describe, expect, it } from 'vitest'
import { allocateFifo } from './core'
import { financialSummary } from './overview'
import type { AnalyticsInput, ASaleLine } from './types'

// Các trường hợp tính lãi lỗ: hoa hồng, FIFO nhiều lô, chỉ có chi phí, hàng chưa bán, làm tròn.
// Khoản chi sinh từ nhập kho (expenses.purchase_id) được loại ở useAnalyticsData nên input.expenses không có chúng.

const product = (id: string, name: string) => ({ id, name, threshold: 3, tracksStock: true })
const line = (id: string, productId: string, date: string, qty: number, unitCost: number) => ({
  id,
  purchaseId: `p-${id}`,
  date,
  productId,
  qty,
  unitCost,
})
const sale = (date: string, productId: string, qty: number, unitPrice: number, commissionRate = 0, channel = 'in_store'): ASaleLine => ({
  date,
  productId,
  qty,
  unitPrice,
  commissionRate,
  channel,
})

function summarize(input: AnalyticsInput) {
  const fifo = allocateFifo(input)
  return financialSummary(input, fifo.allocations, new Map())
}

const base = (over: Partial<AnalyticsInput>): AnalyticsInput => ({
  products: [],
  purchases: [],
  batchLines: [],
  sales: [],
  transfers: [],
  expenses: [],
  prices: [],
  ...over,
})

describe('lãi lỗ: kịch bản Bún đậu (quán + đối tác, nhập kho)', () => {
  // Khớp supabase/tests/pnl_scenario_bundau.sql
  const input = base({
    products: [product('coca', 'Coca'), product('pepsi', 'Pepsi')],
    purchases: [{ id: 'p1', date: '2026-10-21', note: null }],
    batchLines: [
      { ...line('b1', 'coca', '2026-10-21', 10, 8000), purchaseId: 'p1' },
      { ...line('b2', 'pepsi', '2026-10-21', 6, 10000), purchaseId: 'p1' },
    ],
    sales: [sale('2026-10-21', 'coca', 4, 15000), sale('2026-10-21', 'pepsi', 2, 20000, 0.25, 'shopeefood')],
  })
  const s = summarize(input)

  it('doanh thu thuần trừ hoa hồng đối tác', () => {
    expect(s.revenue).toBe(90000) // 60.000 + (40.000 - 25%)
  })
  it('giá vốn chỉ tính hàng đã bán, theo giá lô', () => {
    expect(s.cogs).toBe(52000) // 4×8.000 + 2×10.000
    expect(s.grossProfit).toBe(38000)
  })
  it('chi phí không gồm tiền nhập kho nên lãi ròng = lãi gộp', () => {
    expect(s.expenses).toBe(0)
    expect(s.netProfit).toBe(38000)
  })
  it('tiền nhập, hàng tồn còn lại và dòng tiền', () => {
    expect(s.totalPurchase).toBe(140000)
    expect(s.stockValue).toBe(88000) // 6×8.000 + 4×10.000
    expect(s.cashFlow).toBe(-50000) // 90.000 thu - 140.000 đã chi
  })
})

describe('lãi lỗ: các trường hợp biên', () => {
  it('FIFO qua hai lô khác giá', () => {
    const s = summarize(
      base({
        products: [product('a', 'A')],
        batchLines: [line('l1', 'a', '2026-10-01', 5, 10000), line('l2', 'a', '2026-10-05', 5, 12000)],
        sales: [sale('2026-10-06', 'a', 7, 20000)],
      }),
    )
    expect(s.cogs).toBe(5 * 10000 + 2 * 12000)
    expect(s.revenue).toBe(140000)
    expect(s.stockValue).toBe(3 * 12000)
  })

  it('chỉ có chi phí, chưa bán: lỗ đúng bằng chi phí, biên lãi rỗng', () => {
    const s = summarize(base({ expenses: [{ date: '2026-10-10', amount: 1974000 }] }))
    expect(s.revenue).toBe(0)
    expect(s.netProfit).toBe(-1974000)
    expect(s.margin).toBeNull()
  })

  it('nhập hàng nhưng chưa bán: không có lãi lỗ từ hàng, tiền nhập nằm ở tồn kho', () => {
    const s = summarize(base({ products: [product('a', 'A')], batchLines: [line('l1', 'a', '2026-10-01', 10, 5000)] }))
    expect(s.grossProfit).toBe(0)
    expect(s.netProfit).toBe(0)
    expect(s.stockValue).toBe(50000)
    expect(s.totalPurchase).toBe(50000)
  })

  it('hoa hồng làm tròn 2 số lẻ như get_pnl', () => {
    const s = summarize(
      base({
        products: [product('a', 'A')],
        batchLines: [line('l1', 'a', '2026-10-01', 5, 1000)],
        sales: [sale('2026-10-02', 'a', 3, 33333, 0.25, 'shopeefood')],
      }),
    )
    expect(s.revenue).toBeCloseTo(99999 - 24999.75, 2)
  })

  it('lãi ròng = lãi gộp - chi phí và biên lãi theo doanh thu thuần', () => {
    const s = summarize(
      base({
        products: [product('a', 'A')],
        batchLines: [line('l1', 'a', '2026-10-01', 10, 6000)],
        sales: [sale('2026-10-02', 'a', 10, 10000)],
        expenses: [{ date: '2026-10-02', amount: 20000 }],
      }),
    )
    expect(s.grossProfit).toBe(40000)
    expect(s.netProfit).toBe(20000)
    expect(s.margin).toBeCloseTo(0.2, 5)
  })

  it('bán nhiều hơn đã nhập: phần vượt không có giá vốn (cần báo kiểm tra)', () => {
    const input = base({
      products: [product('a', 'A')],
      batchLines: [line('l1', 'a', '2026-10-01', 2, 5000)],
      sales: [sale('2026-10-02', 'a', 5, 9000)],
    })
    expect(allocateFifo(input).unallocated.get('a')).toBe(3)
  })
})
