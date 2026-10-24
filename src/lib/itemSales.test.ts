import { describe, expect, it } from 'vitest'
import { filterItems, groupItems, totalsOf } from './itemSales'
import type { MonthlyItemSale } from '../types/database'

const row = (item_name: string, category: string | null, qty: number, net: number, item_code = item_name): MonthlyItemSale => ({
  id: item_name, store_id: 's', month: '2026-10-01', period_end: '2026-10-24', category, item_code, item_name, qty, gross: net + 10, discount: 10, net, created_by: null, created_at: '',
})

describe('tổng kết mặt hàng theo tháng', () => {
  const rows = [row('Trà đá', 'Đồ uống', 228, 681_000), row('Mẹt đầy đủ', 'Best Seller', 299, 18_000_000), row('Coca', 'Đồ uống', 22, 330_000), row('Bún thêm', null, 14, 70_000)]

  it('cộng tổng số phần và tiền', () => {
    expect(totalsOf(rows)).toEqual({ items: 4, qty: 563, gross: 19_081_040, discount: 40, net: 19_081_000 })
  })

  it('nhóm theo doanh thu, món trong nhóm theo doanh thu, thiếu nhóm vào Chưa phân loại', () => {
    const g = groupItems(rows)
    expect(g.map((x) => x.category)).toEqual(['Best Seller', 'Đồ uống', 'Chưa phân loại'])
    expect(g[1].items.map((x) => x.item_name)).toEqual(['Trà đá', 'Coca'])
    expect(g[1].qty).toBe(250)
  })

  it('tìm không phân biệt dấu, theo tên hoặc mã', () => {
    expect(filterItems(rows, 'tra da').map((r) => r.item_name)).toEqual(['Trà đá'])
    expect(filterItems(rows, 'MET').map((r) => r.item_name)).toEqual(['Mẹt đầy đủ'])
    expect(filterItems(rows, '  ')).toHaveLength(4)
  })
})
