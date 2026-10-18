import { describe, expect, it } from 'vitest'
import { evalExpression, isExpression } from './calc'

describe('tính toán trong ô tiền', () => {
  it('cộng trừ nhân chia, thứ tự phép tính, ngoặc', () => {
    expect(evalExpression('50000+30000*2')).toBe(110000)
    expect(evalExpression('(12000+8000)/2')).toBe(10000)
    expect(evalExpression('100000 - 15000')).toBe(85000)
    expect(evalExpression('3x25000')).toBe(75000)
    expect(evalExpression('3×25000')).toBe(75000)
    expect(evalExpression('90000:3')).toBe(30000)
    expect(evalExpression('-5000+10000')).toBe(5000)
  })
  it('hậu tố k / tr và dấu chấm phân cách nghìn', () => {
    expect(evalExpression('3x25k')).toBe(75000)
    expect(evalExpression('1.5tr')).toBe(1500000)
    expect(evalExpression('50.000+30.000')).toBe(80000)
    expect(evalExpression('1.250.000')).toBe(1250000)
    expect(evalExpression('2,5*1000')).toBe(2500)
  })
  it('biểu thức sai trả về null, không chạy mã lạ', () => {
    expect(evalExpression('')).toBeNull()
    expect(evalExpression('5+')).toBeNull()
    expect(evalExpression('(5+3')).toBeNull()
    expect(evalExpression('10/0')).toBeNull()
    expect(evalExpression('alert(1)')).toBeNull()
    expect(evalExpression('5 5')).toBe(55)
  })
  it('nhận biết ô có phép tính', () => {
    expect(isExpression('50000')).toBe(false)
    expect(isExpression('50000+1')).toBe(true)
    expect(isExpression('25k')).toBe(true)
  })
})
