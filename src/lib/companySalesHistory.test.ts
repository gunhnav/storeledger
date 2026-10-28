import { describe, expect, it } from 'vitest'
import { summarizeCompanySales, type CompanySaleRow } from './companySalesHistory'

const sale = (id: string, date: string, total: number, items: [string, number][], extra: Partial<CompanySaleRow> = {}): CompanySaleRow => ({
  id,
  sale_date: date,
  total_amount: total,
  discount_amount: null,
  note: null,
  created_at: `${date}T00:00:00Z`,
  sale_items: items.map(([product_id, quantity]) => ({ product_id, quantity, unit_price: 0 })),
  ...extra,
})

describe('lịch sử bán hàng công ty', () => {
  it('cộng tổng, sắp đơn mới nhất trước và vị bán nhiều xếp trước', () => {
    const s = summarizeCompanySales([
      sale('a', '2026-10-01', 400, [['p1', 2], ['p2', 4]]),
      sale('b', '2026-10-03', 600, [['p1', 6]], { discount_amount: 50, note: '  Công ty X ' }),
    ])
    expect(s.lines.map((l) => l.id)).toEqual(['b', 'a'])
    expect(s.lines[1].items).toEqual([{ productId: 'p2', quantity: 4 }, { productId: 'p1', quantity: 2 }])
    expect(s.lines[0]).toMatchObject({ jars: 6, discount: 50, note: 'Công ty X' })
    expect([s.orders, s.jars, s.revenue, s.discount]).toEqual([2, 12, 1000, 50])
  })

  it('gộp các dòng cùng vị và xử lý không có đơn', () => {
    expect(summarizeCompanySales([sale('a', '2026-10-01', 10, [['p1', 1], ['p1', 2]])]).lines[0].items).toEqual([{ productId: 'p1', quantity: 3 }])
    const empty = summarizeCompanySales([])
    expect([empty.orders, empty.jars, empty.revenue, empty.lines.length]).toEqual([0, 0, 0, 0])
  })
})
