import { describe, expect, it } from 'vitest'
import { dayOfYear, hash32, invoiceCode, invoiceMemo } from './invoice'

describe('mã hoá đơn', () => {
  it('ngày trong năm: 25/10/2026 là ngày thứ 298, 1/1 là 1, 31/12 năm không nhuận là 365', () => {
    expect(dayOfYear(new Date(2026, 9, 25))).toBe(298)
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1)
    expect(dayOfYear(new Date(2026, 11, 31))).toBe(365)
  })

  it('có dạng tiền tố + năm + ngày + 4 ký tự, ổn định theo seed', () => {
    const a = invoiceCode(new Date(2026, 9, 25), 'ABC|set4')
    expect(a).toMatch(/^HG26298[2-9A-HJKMNP-Z]{4}$/)
    expect(invoiceCode(new Date(2026, 9, 25), 'ABC|set4')).toBe(a)
    expect(invoiceCode(new Date(2026, 9, 25), 'XYZ|set4')).not.toBe(a)
  })

  it('không dùng ký tự dễ nhầm 0 O 1 I L ở phần đuôi', () => {
    for (let i = 0; i < 300; i++) expect(invoiceCode(new Date(2026, 0, 5), String(i)).slice(7)).not.toMatch(/[01OIL]/)
  })

  it('nội dung chuyển khoản và băm', () => {
    expect(invoiceMemo('HG262987K3Q')).toBe('HOGI HG262987K3Q')
    expect(hash32('a')).toBe(hash32('a'))
    expect(hash32('a')).not.toBe(hash32('b'))
  })
})

import { formatIssued, wrapText } from './invoiceImage'

describe('ảnh hoá đơn', () => {
  const measure = (t: string) => t.length * 10
  it('ngắt dòng theo độ rộng và giữ xuống dòng sẵn có', () => {
    expect(wrapText(measure, 'aaa bbb ccc ddd', 80)).toEqual(['aaa bbb', 'ccc ddd'])
    expect(wrapText(measure, 'ab\ncd', 100)).toEqual(['ab', 'cd'])
    expect(wrapText(measure, 'a_very_long_word x', 50)).toEqual(['a_very_long_word', 'x'])
  })
  it('định dạng ngày giờ lập', () => {
    expect(formatIssued(new Date(2026, 9, 5, 7, 3))).toBe('05/10/2026 07:03')
  })
})
