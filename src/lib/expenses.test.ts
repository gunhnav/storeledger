import { describe, expect, it } from 'vitest'
import { expenseGroupsFor, expenseLine, isBlankDraft, parseDraft, storedUnitPrice } from './expenses'

describe('chi phí đồ dùng: thành tiền', () => {
  it('thành tiền = số lượng × đơn giá', () => {
    expect(expenseLine(4, 11000)).toEqual({ total: 44000, unitPrice: 11000, overridden: false })
  })

  it('ghi đè thành tiền: đơn giá = thành tiền ÷ số lượng, tổng giữ nguyên', () => {
    const line = expenseLine(50, 0, 84480)
    expect(line.total).toBe(84480)
    expect(line.unitPrice).toBeCloseTo(1689.6, 6)
    expect(line.overridden).toBe(true)
    expect(storedUnitPrice(line.unitPrice)).toBe(1689.6)
  })

  it('số lượng 0 không chia cho 0', () => {
    expect(expenseLine(0, 0, 1000).unitPrice).toBe(0)
  })
})

describe('nhóm chi phí theo cửa hàng', () => {
  it('Bún đậu có nhóm riêng, Hogi và quán khác dùng 5 nhóm mặc định', () => {
    expect(expenseGroupsFor('bundau')).toEqual(['Đồ uống', 'Nguyên liệu', 'Dụng cụ', 'Quảng cáo', 'Khác'])
    expect(expenseGroupsFor('hogi')).toEqual(['Dụng cụ', 'Bao bì', 'In ấn - quảng cáo', 'Vận chuyển', 'Khác'])
    expect(expenseGroupsFor(undefined)).toEqual(expenseGroupsFor('hogi'))
  })
})

describe('nhập nhiều chi phí cùng ngày', () => {
  const base = { category: 'Nguyên liệu', note: '', quantity: '1', unitPrice: '', total: '' }
  it('dòng hợp lệ: SL × đơn giá, hoặc ghi đè thành tiền', () => {
    expect(parseDraft({ ...base, note: 'Xoài', quantity: '2', unitPrice: '30000' }, 1e9)).toEqual({ ok: true, quantity: 2, unitPrice: 30000, total: 60000 })
    expect(parseDraft({ ...base, note: 'Xoài', quantity: '3', total: '100000' }, 1e9)).toEqual({ ok: true, quantity: 3, unitPrice: 33333.33, total: 100000 })
  })
  it('dòng lỗi: thiếu tiền, số lượng 0, quá lớn', () => {
    expect(parseDraft({ ...base, note: 'Xoài' }, 1e9)).toEqual({ ok: false, error: 'Nhập đơn giá hoặc thành tiền' })
    expect(parseDraft({ ...base, quantity: '0', unitPrice: '1000' }, 1e9)).toEqual({ ok: false, error: 'Số lượng phải lớn hơn 0' })
    expect(parseDraft({ ...base, unitPrice: '2000000000' }, 1e9)).toEqual({ ok: false, error: 'Số tiền quá lớn, kiểm tra lại' })
  })
  it('dòng trống (chỉ có SL mặc định 1) được bỏ qua', () => {
    expect(isBlankDraft(base)).toBe(true)
    expect(isBlankDraft({ ...base, note: 'Đá' })).toBe(false)
  })
})

describe('ô tiền có phép tính', () => {
  const base = { category: 'Nguyên liệu', note: 'Lòng', quantity: '1', unitPrice: '', total: '' }
  it('thành tiền là phép tính', () => {
    expect(parseDraft({ ...base, total: '50000+30000*2' }, 1e9)).toEqual({ ok: true, quantity: 1, unitPrice: 110000, total: 110000 })
    expect(parseDraft({ ...base, quantity: '3', unitPrice: '25k' }, 1e9)).toEqual({ ok: true, quantity: 3, unitPrice: 25000, total: 75000 })
  })
  it('phép tính sai báo lỗi rõ ô nào', () => {
    expect(parseDraft({ ...base, total: '5000+' }, 1e9)).toEqual({ ok: false, error: 'Phép tính ở ô Thành tiền không hợp lệ' })
    expect(parseDraft({ ...base, unitPrice: '(3' }, 1e9)).toEqual({ ok: false, error: 'Phép tính ở ô Đơn giá không hợp lệ' })
  })
})
