import { describe, expect, it } from 'vitest'
import { discountAmount, discountError } from './discount'

const pct = (value: string) => ({ type: 'percent' as const, value })
const amt = (value: string) => ({ type: 'amount' as const, value })

describe('giảm giá đơn bán', () => {
  it('theo phần trăm, làm tròn về đồng', () => {
    expect(discountAmount(60000, pct('10'))).toBe(6000)
    expect(discountAmount(99999, pct('10'))).toBe(10000) // 9.999,9 -> 10.000
    expect(discountAmount(55000, pct('12.5'))).toBe(6875)
    expect(discountAmount(55000, pct('12,5'))).toBe(6875)
  })

  it('theo số tiền', () => {
    expect(discountAmount(40000, amt('5000'))).toBe(5000)
    expect(discountAmount(40000, amt('40000'))).toBe(40000) // giảm hết
  })

  it('để trống hoặc không hợp lệ thì không giảm', () => {
    expect(discountAmount(40000, amt(''))).toBe(0)
    expect(discountAmount(40000, amt('abc'))).toBe(0)
    expect(discountAmount(40000, amt('0'))).toBe(0)
    expect(discountAmount(40000, pct('-5'))).toBe(0)
    expect(discountAmount(0, pct('10'))).toBe(0)
  })

  it('báo lỗi: quá 100%, vượt tiền hàng, bằng 0', () => {
    expect(discountError(40000, pct('101'))).toMatch(/100%/)
    expect(discountError(40000, amt('40001'))).toMatch(/lớn hơn tiền hàng/)
    expect(discountError(40000, amt('0'))).toMatch(/lớn hơn 0/)
    expect(discountError(40000, pct('100'))).toBeNull()
    expect(discountError(40000, amt(''))).toBeNull()
  })

  it('giá trị không hợp lệ thì không áp dụng (không vượt tiền hàng)', () => {
    expect(discountAmount(40000, amt('50000'))).toBe(0)
    expect(discountAmount(40000, pct('150'))).toBe(0)
  })
})
