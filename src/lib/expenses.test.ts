import { describe, expect, it } from 'vitest'
import { expenseGroupsFor, expenseLine, storedUnitPrice } from './expenses'

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
