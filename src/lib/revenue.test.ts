import { describe, expect, it } from 'vitest'
import { commissionOf, summarize } from './revenue'

describe('doanh thu nhập tay', () => {
  it('hoa hồng chỉ tính cho kênh đối tác', () => {
    expect(commissionOf(1_000_000, 'in_store', 0.25)).toBe(0)
    expect(commissionOf(1_000_000, 'shopeefood', 0.25)).toBe(250_000)
  })

  it('tổng hợp doanh thu, hoa hồng, chi phí và lãi theo ngày', () => {
    const s = summarize(
      [
        { revenue_date: '2026-10-02', channel: 'in_store', amount: 3_000_000 },
        { revenue_date: '2026-10-02', channel: 'shopeefood', amount: 1_000_000 },
        { revenue_date: '2026-10-01', channel: 'in_store', amount: 2_000_000 },
      ],
      [
        { expense_date: '2026-10-02', amount: 1_500_000 },
        { expense_date: '2026-10-03', amount: 200_000 },
      ],
      0.25,
    )
    expect(s.gross).toBe(6_000_000)
    expect(s.commission).toBe(250_000)
    expect(s.net).toBe(5_750_000)
    expect(s.expenses).toBe(1_700_000)
    expect(s.profit).toBe(4_050_000)
    expect(s.byChannel).toEqual({ in_store: 5_000_000, shopeefood: 1_000_000 })
    expect(s.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(s.days[2]).toEqual({ date: '2026-10-03', gross: 0, commission: 0, expenses: 200_000 })
  })

  it('không có dữ liệu thì mọi số bằng 0', () => {
    const s = summarize([], [], 0.25)
    expect([s.gross, s.net, s.expenses, s.profit, s.days.length]).toEqual([0, 0, 0, 0, 0])
  })
})
