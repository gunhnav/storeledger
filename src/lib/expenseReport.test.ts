import { describe, expect, it } from 'vitest'
import { expenseByGroup, expenseRatio, fixedTotal, totalOf } from './expenseReport'

describe('báo cáo chi phí theo nhóm', () => {
  const cur = [
    { category: 'Nguyên liệu', amount: 600 },
    { category: 'Nguyên liệu', amount: 200 },
    { category: 'Tiền nhà', amount: 1000 },
    { category: 'Dụng cụ', amount: 200 },
  ]
  const prev = [{ category: 'Nguyên liệu', amount: 500 }, { category: 'Điện nước', amount: 300 }]

  it('cộng theo nhóm, xếp số tiền cao trước, tính tỷ trọng và kỳ trước', () => {
    const g = expenseByGroup(cur, prev)
    expect(g.map((x) => [x.category, x.amount, x.count, x.previous])).toEqual([
      ['Tiền nhà', 1000, 1, 0],
      ['Nguyên liệu', 800, 2, 500],
      ['Dụng cụ', 200, 1, 0],
      ['Điện nước', 0, 0, 300],
    ])
    expect(g[0].share).toBe(0.5)
    expect(g[3].share).toBe(0)
  })

  it('tổng, chi phí cố định và tỷ lệ trên doanh thu', () => {
    expect(totalOf(cur)).toBe(2000)
    expect(fixedTotal(cur)).toBe(1000)
    expect(expenseRatio(2000, 8000)).toBe(0.25)
    expect(expenseRatio(2000, 0)).toBeNull()
  })

  it('không có dữ liệu thì không có dòng nào', () => {
    expect(expenseByGroup([], [])).toEqual([])
  })
})
