import { describe, expect, it } from 'vitest'
import { cellKey, gridDates, movedByCell, overHome, parseEntries, splitKey, totalsByProduct } from './transferGrid'

describe('lưới Mang ra quán', () => {
  it('7 cột ngày kết thúc hôm nay, qua ranh giới tháng', () => {
    expect(gridDates('2026-11-02', 7)).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
  })

  it('cộng dồn số đã mang ra theo ô', () => {
    const moved = movedByCell([
      { productId: 'tt', date: '2026-10-15', qty: 20 },
      { productId: 'tt', date: '2026-10-15', qty: 5 },
      { productId: 'mt', date: '2026-10-16', qty: 3 },
    ])
    expect(moved.get(cellKey('tt', '2026-10-15'))).toBe(25)
    expect(moved.get(cellKey('mt', '2026-10-16'))).toBe(3)
    expect(moved.get(cellKey('mt', '2026-10-15'))).toBeUndefined()
  })

  it('khoá ô tách lại đúng món và ngày', () => {
    expect(splitKey(cellKey('a|b', '2026-10-18'))).toEqual({ productId: 'a|b', date: '2026-10-18' })
  })

  it('đọc ô: bỏ ô trống / 0, báo số lẻ, âm, quá lớn, ngày tương lai; sắp ngày cũ trước', () => {
    const { entries, errors } = parseEntries(
      {
        [cellKey('tt', '2026-10-16')]: '3',
        [cellKey('tt', '2026-10-15')]: ' 25 ',
        [cellKey('nc', '2026-10-15')]: '',
        [cellKey('mt', '2026-10-15')]: '0',
        [cellKey('pm', '2026-10-15')]: '1.5',
        [cellKey('cc', '2026-10-15')]: '-2',
        [cellKey('cc', '2026-10-16')]: '20000',
        [cellKey('nc', '2026-10-19')]: '1',
      },
      '2026-10-18',
    )
    expect(entries).toEqual([
      { productId: 'tt', date: '2026-10-15', qty: 25 },
      { productId: 'tt', date: '2026-10-16', qty: 3 },
    ])
    expect(errors).toEqual([
      { key: cellKey('pm', '2026-10-15'), reason: 'not_integer' },
      { key: cellKey('cc', '2026-10-15'), reason: 'not_integer' },
      { key: cellKey('cc', '2026-10-16'), reason: 'too_large' },
      { key: cellKey('nc', '2026-10-19'), reason: 'future' },
    ])
  })

  it('dữ liệu mẫu: nhập 50 truyền thống, mang ra 25 + 0 thì không vượt; mang thêm 30 thì vượt', () => {
    const home = new Map([['tt', 25]])
    const ok = [{ productId: 'tt', date: '2026-10-17', qty: 25 }]
    expect(overHome(ok, home)).toEqual([])
    const tooMany = [...ok, { productId: 'tt', date: '2026-10-18', qty: 5 }]
    expect(totalsByProduct(tooMany).get('tt')).toBe(30)
    expect(overHome(tooMany, home)).toEqual([{ productId: 'tt', want: 30, home: 25 }])
    expect(overHome([{ productId: 'mt', date: '2026-10-18', qty: 1 }], home)).toEqual([{ productId: 'mt', want: 1, home: 0 }])
  })
})
