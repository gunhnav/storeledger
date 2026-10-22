import { describe, expect, it } from 'vitest'
import { daysLeft, formatQty, ingredientStatus, normalizeRecipeLines } from './ingredients'

describe('trạng thái tồn nguyên liệu', () => {
  it('hết, sắp hết, ổn, cần kiểm tra', () => {
    expect(ingredientStatus(0, 10)).toBe('out')
    expect(ingredientStatus(5, 10)).toBe('low')
    expect(ingredientStatus(10, 10)).toBe('low')
    expect(ingredientStatus(11, 10)).toBe('ok')
    expect(ingredientStatus(-2, 10)).toBe('check')
  })
  it('ngưỡng 0 nghĩa là không cảnh báo sắp hết', () => {
    expect(ingredientStatus(1, 0)).toBe('ok')
  })
})

describe('số ngày còn dùng được', () => {
  it('theo tốc độ dùng gần đây', () => {
    expect(daysLeft(90, 70, 7)).toBe(9) // 10 / ngày
    expect(daysLeft(25, 70, 7)).toBe(2)
  })
  it('hết thì 0, chưa dùng thì không ước tính', () => {
    expect(daysLeft(0, 70, 7)).toBe(0)
    expect(daysLeft(-3, 70, 7)).toBe(0)
    expect(daysLeft(50, 0, 7)).toBeNull()
  })
})

describe('định dạng và công thức', () => {
  it('bỏ số 0 thừa', () => {
    expect(formatQty(12)).toBe('12')
    expect(formatQty(2.5)).toBe('2,5')
    expect(formatQty(0.333333)).toBe('0,33')
  })
  it('gom dòng cùng nguyên liệu, bỏ dòng trống, nhận dấu phẩy', () => {
    expect(
      normalizeRecipeLines([
        { ingredient_id: 'a', qty: '1' },
        { ingredient_id: 'a', qty: '0,5' },
        { ingredient_id: 'b', qty: '' },
        { ingredient_id: '', qty: '3' },
        { ingredient_id: 'c', qty: '-1' },
      ]),
    ).toEqual([{ ingredient_id: 'a', qty: 1.5 }])
  })
})
