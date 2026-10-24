import { describe, expect, it } from 'vitest'
import { reconcile, splitByLine, visibleItems, applyFilter, filterItems, groupByDay, groupItems, isDayRow, mergeByName, totalsOf } from './itemSales'
import type { MonthlyItemSale } from '../types/database'

const row = (item_name: string, category: string | null, qty: number, net: number, item_code = item_name): MonthlyItemSale => ({
  id: item_name, store_id: 's', month: '2026-10-01', period_start: '2026-10-01', period_end: '2026-10-24', category, item_code, item_name, qty, gross: net + 10, discount: 10, net, created_by: null, created_at: '',
})

describe('tổng kết mặt hàng theo tháng', () => {
  const rows = [row('Trà đá', 'Đồ uống', 228, 681_000), row('Mẹt đầy đủ', 'Best Seller', 299, 18_000_000), row('Coca', 'Đồ uống', 22, 330_000), row('Bún thêm', null, 14, 70_000)]

  it('cộng tổng số phần và tiền', () => {
    expect(totalsOf(rows)).toEqual({ items: 4, qty: 563, gross: 19_081_040, discount: 40, net: 19_081_000 })
  })

  it('nhóm theo doanh thu, món trong nhóm theo doanh thu, thiếu nhóm vào Chưa phân loại', () => {
    const g = groupItems(rows)
    expect(g.map((x) => x.category)).toEqual(['Best Seller', 'Đồ uống', 'Chưa phân loại'])
    expect(g[1].items.map((x) => x.item_name)).toEqual(['Trà đá', 'Coca'])
    expect(g[1].qty).toBe(250)
  })

  it('tìm không phân biệt dấu, theo tên hoặc mã', () => {
    expect(filterItems(rows, 'tra da').map((r) => r.item_name)).toEqual(['Trà đá'])
    expect(filterItems(rows, 'MET').map((r) => r.item_name)).toEqual(['Mẹt đầy đủ'])
    expect(filterItems(rows, '  ')).toHaveLength(4)
  })
})

describe('xem mặt hàng theo ngày', () => {
  const day = (date: string, name: string, cat: string | null, qty: number, net: number): MonthlyItemSale => ({
    ...row(name, cat, qty, net), period_start: date, period_end: date,
  })
  const rows = [day('2026-10-10', 'Trà đá', 'Đồ uống', 20, 60_000), day('2026-10-10', 'Mẹt', 'Best Seller', 5, 300_000), day('2026-10-11', 'Trà đá', 'Đồ uống', 30, 90_000)]

  it('nhận ra báo cáo một ngày', () => {
    expect(isDayRow(rows[0])).toBe(true)
    expect(isDayRow(row('A', null, 1, 1))).toBe(false)
  })

  it('lọc theo khoảng ngày, nhóm và từ khoá', () => {
    expect(applyFilter(rows, { from: '2026-10-11' }).map((r) => r.item_name)).toEqual(['Trà đá'])
    expect(applyFilter(rows, { category: 'Best Seller' }).map((r) => r.item_name)).toEqual(['Mẹt'])
    expect(applyFilter(rows, { query: 'tra', to: '2026-10-10' })).toHaveLength(1)
  })

  it('gom theo ngày mới nhất trước, mỗi ngày có tổng', () => {
    const d = groupByDay(rows)
    expect(d.map((x) => [x.date, x.qty, x.net])).toEqual([['2026-10-11', 30, 90_000], ['2026-10-10', 25, 360_000]])
    expect(d[1].groups[0].category).toBe('Best Seller')
  })

  it('cộng các ngày theo mặt hàng', () => {
    const m = mergeByName(rows, false)
    expect(m.find((r) => r.item_code === 'Trà đá')).toMatchObject({ qty: 50, net: 150_000, period_start: '2026-10-10', period_end: '2026-10-11' })
    expect(m).toHaveLength(2)
  })

  it('chỉ gom trong cùng khoảng ngày khi perPeriod', () => {
    expect(mergeByName(rows)).toHaveLength(3)
  })
})

describe('đối chiếu doanh thu với mặt hàng', () => {
  const d = (date: string, net: number) => ({ period_start: date, period_end: date, net })
  it('báo ngày lệch, bỏ qua ngày khớp', () => {
    const revenue = new Map([['2026-10-10', 1000], ['2026-10-11', 500]])
    const m = reconcile([d('2026-10-10', 1000), d('2026-10-10', 0), d('2026-10-11', 450)], revenue)
    expect(m).toEqual([{ start: '2026-10-11', end: '2026-10-11', revenue: 500, items: 450, diff: 50 }])
  })

  it('báo khi có mặt hàng mà không có doanh thu; khoảng nhiều ngày cộng doanh thu các ngày trong khoảng', () => {
    expect(reconcile([d('2026-10-12', 300)], new Map())).toEqual([{ start: '2026-10-12', end: '2026-10-12', revenue: 0, items: 300, diff: -300 }])
    const range = { period_start: '2026-10-01', period_end: '2026-10-03', net: 90 }
    expect(reconcile([range], new Map([['2026-10-01', 30], ['2026-10-02', 30], ['2026-10-03', 30], ['2026-10-04', 999]]))).toEqual([])
  })

  it('nhóm Bún bò bị ẩn khỏi danh sách', () => {
    expect(visibleItems([row('A', 'Bún bò', 1, 1), row('B', 'Đồ uống', 1, 1)]).map((r) => r.item_name)).toEqual(['B'])
  })
})

describe('gom mặt hàng trùng tên', () => {
  const r = (code: string, name: string, cat: string | null, qty: number, net: number): MonthlyItemSale => ({ ...row(name, cat, qty, net, code) })

  it('gom hai mã cùng tên, không phân biệt hoa thường và khoảng trắng, ghép mã, lấy nhóm của dòng lớn nhất', () => {
    const m = mergeByName([r('BD07', 'Mẹt bún đậu đầy đủ', 'Best Seller', 299, 18_000_000), r('MB', 'Mẹt bún đậu  đầy đủ ', 'Best Seller', 131, 7_529_990), r('KL', 'Khăn Lạnh', null, 1, 3000), r('DU08', 'Khăn lạnh', 'Đồ uống', 43, 129000)])
    expect(m).toHaveLength(2)
    expect(m.find((x) => x.item_code === 'BD07, MB')).toMatchObject({ qty: 430, net: 25_529_990, category: 'Best Seller' })
    expect(m.find((x) => x.item_code === 'DU08, KL')).toMatchObject({ item_name: 'Khăn lạnh', qty: 44, net: 132_000, category: 'Đồ uống' })
  })

  it('giữ dấu: "đầu" và "đậu" là hai món khác nhau', () => {
    expect(mergeByName([r('A', 'Mẹt bún đầu', null, 1, 1), r('B', 'Mẹt bún đậu', null, 1, 1)])).toHaveLength(2)
  })
})

describe('tách doanh thu Bún bò và Bún đậu', () => {
  const p = (start: string, end: string, category: string | null, net: number) => ({ period_start: start, period_end: end, category, net })
  const rows = [p('2026-10-01', '2026-10-24', 'Bún bò', 300), p('2026-10-01', '2026-10-24', 'Đồ uống', 500), p('2026-10-01', '2026-10-24', null, 200), p('2026-09-01', '2026-09-30', 'Bún bò', 999)]

  it('Bún bò riêng, mọi nhóm còn lại là Bún đậu, chỉ lấy báo cáo nằm trọn trong khoảng', () => {
    const s = splitByLine(rows, '2026-10-01', '2026-10-31')
    expect([s.bunBo, s.bunDau, s.skipped]).toEqual([300, 700, 0])
    expect(s.used).toEqual([{ start: '2026-10-01', end: '2026-10-24' }])
  })

  it('báo cáo chỉ giao một phần thì bỏ qua và đếm lại', () => {
    const s = splitByLine(rows, '2026-10-18', '2026-10-24')
    expect([s.bunBo, s.bunDau, s.used.length, s.skipped]).toEqual([0, 0, 0, 1])
  })
})
