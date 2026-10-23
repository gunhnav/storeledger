import { describe, expect, it } from 'vitest'
import { stockRows } from './overview'
import { dailyResults, allocateFifo } from './core'
import type { AnalyticsInput } from './types'

// Chuyển hàng từ quán về nhà (destination 'home'): nhà +, quán -, rồi phân phối cho công ty từ số vừa chuyển về
const input = (transfers: AnalyticsInput['transfers']): AnalyticsInput => ({
  products: [{ id: 'pm', name: 'Phô mai', threshold: 3, tracksStock: true }],
  purchases: [{ id: 'p1', date: '2026-10-15', note: null }],
  batchLines: [{ id: 'b1', purchaseId: 'p1', date: '2026-10-15', productId: 'pm', qty: 10, unitCost: 11000 }],
  sales: [],
  transfers,
  expenses: [],
  prices: [],
})

describe('chuyển hàng từ quán về nhà', () => {
  it('nhà tăng, quán giảm, tổng mang ra giảm', () => {
    const [row] = stockRows(input([
      { date: '2026-10-15', productId: 'pm', qty: 10, destination: 'shop' },
      { date: '2026-10-16', productId: 'pm', qty: 4, destination: 'home' },
    ]))
    expect(row.home).toBe(4)
    expect(row.shop).toBe(6)
    expect(row.moved).toBe(6)
    expect(row.movedShop).toBe(6)
  })

  it('chuyển về nhà rồi phân phối cho công ty', () => {
    const [row] = stockRows(input([
      { date: '2026-10-15', productId: 'pm', qty: 10, destination: 'shop' },
      { date: '2026-10-16', productId: 'pm', qty: 4, destination: 'home' },
      { date: '2026-10-17', productId: 'pm', qty: 4, destination: 'company' },
    ]))
    expect(row.home).toBe(0)
    expect(row.shop).toBe(6)
    expect(row.company).toBe(4)
  })

  it('tồn nhà cuối ngày trong báo cáo theo ngày', () => {
    const i = input([
      { date: '2026-10-15', productId: 'pm', qty: 10, destination: 'shop' },
      { date: '2026-10-16', productId: 'pm', qty: 4, destination: 'home' },
    ])
    const days = dailyResults(i, allocateFifo(i), '2026-10-15', '2026-10-16')
    expect(days[0].homeStock.pm).toBe(0)
    expect(days[1].homeStock.pm).toBe(4)
  })
})
