import { describe, expect, it } from 'vitest'
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
