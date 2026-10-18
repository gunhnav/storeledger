import { describe, expect, it } from 'vitest'
import { capitalizeFirst } from './format'

describe('viết hoa chữ cái đầu ô Hạng mục', () => {
  it('viết hoa chữ đầu, giữ phần còn lại', () => {
    expect(capitalizeFirst('tắc tươi')).toBe('Tắc tươi')
    expect(capitalizeFirst('đá viên')).toBe('Đá viên')
    expect(capitalizeFirst('ống hút iPhone')).toBe('Ống hút iPhone')
    expect(capitalizeFirst('  menu')).toBe('  Menu')
    expect(capitalizeFirst('Menu')).toBe('Menu')
    expect(capitalizeFirst('5 thùng')).toBe('5 thùng')
    expect(capitalizeFirst('')).toBe('')
  })
})
