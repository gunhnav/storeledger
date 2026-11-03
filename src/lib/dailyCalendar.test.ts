import { describe, expect, it } from 'vitest'
import { customerNote, monthWeeks, setCountFromNote, summarizeByDay, sumQty, type CalendarSaleRow } from './dailyCalendar'

describe('setCountFromNote', () => {
  it('cộng số set của mọi nhóm trong ghi chú', () => {
    expect(setCountFromNote('1 set 4 (4 Truyền thống) × 50.000 ₫ + 1 set 6 (6 Truyền thống) × 70.000 ₫ · Ny')).toBe(2)
    expect(setCountFromNote('3 set 6 (6 Truyền thống) × 70.000 ₫ · chị Nhung')).toBe(3)
  })
  it('null khi ghi chú không có phần set', () => {
    expect(setCountFromNote('Rôn ăn')).toBeNull()
    expect(setCountFromNote(null)).toBeNull()
  })
})

describe('customerNote', () => {
  it('lấy phần ghi chú sau " · " của đơn set', () => {
    expect(customerNote('1 set 4 (4 Matcha) × 55.000 ₫ · nghia.nguyen4')).toBe('nghia.nguyen4')
    expect(customerNote('1 set 4 (4 Matcha) × 55.000 ₫')).toBe('')
  })
  it('giữ nguyên ghi chú thường', () => {
    expect(customerNote('hàng xấu')).toBe('hàng xấu')
  })
})

describe('summarizeByDay', () => {
  const rows: CalendarSaleRow[] = [
    { id: 'a', sale_date: '2026-11-01', channel: 'in_store', total_amount: 45000, note: null, sale_items: [{ product_id: 'm', quantity: 1 }, { product_id: 'p', quantity: 2 }] },
    { id: 'b', sale_date: '2026-11-01', channel: 'company', total_amount: 120000, note: '1 set 4 (4 TT) × 50.000 ₫ + 1 set 6 (6 TT) × 70.000 ₫ · Ny', sale_items: [{ product_id: 't', quantity: 10 }] },
    { id: 'c', sale_date: '2026-11-01', channel: 'shopeefood', total_amount: 15000, note: null, sale_items: [{ product_id: 'p', quantity: 1 }] },
  ]
  it('tách Quán / Công ty và cộng tổng', () => {
    const day = summarizeByDay(rows).get('2026-11-01')!
    expect(Object.fromEntries(day.total)).toEqual({ m: 1, p: 3, t: 10 })
    expect(Object.fromEntries(day.shop)).toEqual({ m: 1, p: 3 })
    expect(Object.fromEntries(day.company)).toEqual({ t: 10 })
    expect(day.companySets).toBe(2)
    expect(day.companyOrders).toHaveLength(1)
    expect(day.shopOrders).toHaveLength(2)
    expect(sumQty(day.total)).toBe(14)
  })
})

describe('monthWeeks', () => {
  it('tuần bắt đầu Thứ Hai, đủ 7 ô', () => {
    // 01/11/2026 là Chủ nhật
    const weeks = monthWeeks('2026-11-15')
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01'])
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks.flat().filter(Boolean)).toHaveLength(30)
  })
})
