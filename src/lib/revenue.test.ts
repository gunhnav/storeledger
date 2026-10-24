import { describe, expect, it } from 'vitest'
import { commissionOf, dayProfit, dayRevenue, filterDays, summarize, sumDays } from './revenue'

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
    expect(s.byChannel).toEqual({ in_store: 5_000_000, shopeefood: 1_000_000, nem_cuon: 0 })
    expect(s.days[1].byChannel).toEqual({ in_store: 3_000_000, shopeefood: 1_000_000, nem_cuon: 0 })
    expect(s.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(s.days[2]).toEqual({ date: '2026-10-03', gross: 0, commission: 0, expenses: 200_000, byChannel: { in_store: 0, shopeefood: 0, nem_cuon: 0 } })
  })

  it('doanh thu bán nem cuốn tính vào doanh thu nhưng không có hoa hồng', () => {
    const s = summarize([{ revenue_date: '2026-10-04', channel: 'nem_cuon', amount: 2_142_000 }], [], 0.25)
    expect([s.gross, s.commission, s.net, s.byChannel.nem_cuon]).toEqual([2_142_000, 0, 2_142_000, 2_142_000])
  })

  it('không có dữ liệu thì mọi số bằng 0', () => {
    const s = summarize([], [], 0.25)
    expect([s.gross, s.net, s.expenses, s.profit, s.days.length]).toEqual([0, 0, 0, 0, 0])
  })
})

describe('lọc bảng chi tiết theo ngày', () => {
  const day = (date: string, q: number, d: number, n: number, expenses = 0, commission = 0) => ({ date, gross: q + d + n, commission, expenses, byChannel: { in_store: q, shopeefood: d, nem_cuon: n } })
  const days = [day('2026-10-01', 100, 0, 0, 40), day('2026-10-02', 50, 20, 30, 10, 5), day('2026-10-03', 0, 0, 80, 0)]

  it('lọc theo khoảng ngày', () => {
    expect(filterDays(days, { from: '2026-10-02', to: '', channel: '', sort: 'date_asc' }).map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03'])
  })

  it('lọc theo kênh chỉ giữ ngày có doanh thu kênh đó và xếp theo doanh thu kênh', () => {
    const r = filterDays(days, { from: '', to: '', channel: 'nem_cuon', sort: 'revenue_desc' })
    expect(r.map((d) => d.date)).toEqual(['2026-10-03', '2026-10-02'])
    expect(dayRevenue(r[0], 'nem_cuon')).toBe(80)
  })

  it('xếp theo lãi và tính tổng', () => {
    expect(filterDays(days, { from: '', to: '', channel: '', sort: 'profit_desc' }).map((d) => [d.date, dayProfit(d)])).toEqual([['2026-10-02', 85], ['2026-10-03', 80], ['2026-10-01', 60]])
    const t = sumDays(days)
    expect([t.gross, t.commission, t.expenses, t.byChannel.nem_cuon]).toEqual([280, 5, 50, 110])
  })
})
