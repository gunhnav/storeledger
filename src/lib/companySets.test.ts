import { describe, expect, it } from 'vitest'
import {
  describeSets,
  groupIssue,
  overHomeSets,
  saleFromSets,
  setKey,
  setKinds,
  setTotals,
  type CompanySetRow,
  type SetGroup,
} from './companySets'

const names = new Map([
  ['tt', 'Truyền thống'],
  ['cc', 'Cacao'],
  ['mt', 'Matcha'],
])

describe('phân phối cho Công ty theo set', () => {
  it('set 4 và set 6 mix nhiều vị: cộng đúng tổng hũ từng vị', () => {
    const groups: SetGroup[] = [
      { id: 'a', size: 4, count: 5, mix: { tt: 2, cc: 2 } },
      { id: 'b', size: 6, count: 3, mix: { tt: 2, cc: 2, mt: 2 } },
    ]
    const totals = setTotals(groups)
    expect(totals.get('tt')).toBe(16)
    expect(totals.get('cc')).toBe(16)
    expect(totals.get('mt')).toBe(6)
    expect(describeSets(groups, names)).toBe('5 set 4 (2 Truyền thống + 2 Cacao) + 3 set 6 (2 Truyền thống + 2 Cacao + 2 Matcha)')
  })

  it('báo lỗi khi vị trong 1 set chưa đủ / vượt cỡ set hoặc số set sai; nhóm lỗi không được cộng', () => {
    expect(groupIssue({ id: 'x', size: 4, count: 2, mix: { tt: 3 } })).toBe('mix_short')
    expect(groupIssue({ id: 'x', size: 4, count: 2, mix: { tt: 3, cc: 2 } })).toBe('mix_over')
    expect(groupIssue({ id: 'x', size: 6, count: 0, mix: { tt: 6 } })).toBe('count')
    expect(groupIssue({ id: 'x', size: 6, count: 1.5, mix: { tt: 6 } })).toBe('count')
    expect(groupIssue({ id: 'x', size: 4, count: 1, mix: { tt: 4.5, cc: -0.5 } })).toBe('mix_invalid')
    expect(groupIssue({ id: 'x', size: 6, count: 1, mix: { tt: 6 } })).toBeNull()
    expect(setTotals([{ id: 'x', size: 4, count: 2, mix: { tt: 3 } }]).size).toBe(0)
  })

  it('cảnh báo vị cần nhiều hơn số ở nhà', () => {
    const totals = new Map([
      ['tt', 16],
      ['mt', 6],
    ])
    const home = new Map([
      ['tt', 25],
      ['mt', 2],
    ])
    expect(overHomeSets(totals, home)).toEqual([{ productId: 'mt', want: 6, home: 2 }])
  })
})

describe('bán kênh Công ty theo set đã phân phối', () => {
  const rows: CompanySetRow[] = [
    { set_size: 4, set_count: 1, mix: { mt: 1, pm: 1, nc: 1, tt: 1 } },
    { set_size: 4, set_count: 1, mix: { tt: 2, nc: 1, pm: 1 } },
    { set_size: 4, set_count: 2, mix: { pm: 1, nc: 1, tt: 2, mt: 0 } },
  ]

  it('gộp các lần phân phối cùng thành phần (không phụ thuộc thứ tự vị, bỏ vị 0)', () => {
    const kinds = setKinds(rows)
    expect(kinds).toHaveLength(2)
    expect(kinds[1].distributed).toBe(3)
    expect(setKey(4, { tt: 2, nc: 1, pm: 1 })).toBe(setKey(4, { pm: 1, nc: 1, tt: 2, mt: 0 }))
  })

  it('đơn bán: số hũ từng vị và tổng tiền theo số set × giá 1 set', () => {
    const kinds = setKinds(rows)
    const sale = saleFromSets(kinds, {
      [kinds[0].key]: { count: 1, price: 55000 },
      [kinds[1].key]: { count: 2, price: 50000 },
    })
    expect(sale.sets).toBe(3)
    expect(sale.total).toBe(155000)
    expect(Object.fromEntries(sale.jars)).toEqual({ mt: 1, pm: 3, nc: 3, tt: 5 })
  })

  it('không chọn set nào thì đơn trống', () => {
    expect(saleFromSets(setKinds(rows), {}).jars.size).toBe(0)
  })
})
