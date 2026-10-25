import { describe, expect, it } from 'vitest'
import { itemsToPrepare, preorderAlert, summarizePreorders } from './preorders'

describe('đơn đặt trước phía quản trị', () => {
  const rows = [
    { status: 'new' as const, total: 115000, lines: [{ kind: 'set' as const, title: 'Set 4 hũ', detail: '2 Phô mai + 2 Truyền thống', qty: 1, unit_price: 55000 }, { kind: 'single' as const, title: 'Hũ làm quen 110gr', detail: 'Bán lẻ', qty: 2, unit_price: 30000 }] },
    { status: 'paid' as const, total: 30000, lines: [{ kind: 'single' as const, title: 'Hũ làm quen 110gr', detail: 'Bán lẻ', qty: 1, unit_price: 30000 }] },
    { status: 'delivered' as const, total: 50000, lines: [{ kind: 'set' as const, title: 'Set 4 hũ', detail: '4 Truyền thống', qty: 1, unit_price: 50000 }] },
    { status: 'cancelled' as const, total: 999, lines: [] },
  ]
  it('đếm theo trạng thái, tổng tiền đơn đang mở (chưa giao, chưa huỷ)', () => {
    const s = summarizePreorders(rows)
    expect(s.counts).toEqual({ new: 1, confirmed: 0, paid: 1, delivered: 1, cancelled: 1 })
    expect(s.openTotal).toBe(145000)
  })
  it('món cần chuẩn bị chỉ tính đơn chưa giao', () => {
    expect(itemsToPrepare(rows)).toEqual([{ title: 'Hũ làm quen 110gr', qty: 3 }, { title: 'Set 4 hũ (2 Phô mai + 2 Truyền thống)', qty: 1 }])
  })
  it('câu thông báo đơn mới', () => {
    expect(preorderAlert({ code: 'HG26298ABCD', customer_name: 'Hường', customer_domain: 'huong.vu3', floor: '6', total: 115000 })).toBe('Đơn đặt trước mới HG26298ABCD: Hường (huong.vu3, tầng 6) · 115.000đ')
  })
})
