import { describe, expect, it } from 'vitest'
import { summarizeByChannel } from './channelRevenue'

describe('doanh thu Hogi theo kênh', () => {
  it('cộng theo kênh và theo ngày', () => {
    const s = summarizeByChannel([
      { sale_date: '2026-10-02', channel: 'in_store', total_amount: 100 },
      { sale_date: '2026-10-02', channel: 'company', total_amount: 300 },
      { sale_date: '2026-10-01', channel: 'in_store', total_amount: 50 },
      { sale_date: '2026-10-02', channel: 'in_store', total_amount: 20 },
    ])
    expect(s.total).toBe(470)
    expect(s.orders).toBe(4)
    expect(s.byChannel.in_store).toEqual({ amount: 170, orders: 3 })
    expect(s.byChannel.company).toEqual({ amount: 300, orders: 1 })
    expect(s.byChannel.shopeefood).toEqual({ amount: 0, orders: 0 })
    expect(s.days.map((d) => [d.date, d.total, d.byChannel.company])).toEqual([['2026-10-01', 50, 0], ['2026-10-02', 420, 300]])
  })

  it('không có đơn thì mọi số bằng 0', () => {
    const s = summarizeByChannel([])
    expect([s.total, s.orders, s.days.length]).toEqual([0, 0, 0])
  })
})
