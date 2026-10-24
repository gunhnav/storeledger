import { describe, expect, it } from 'vitest'
import { parseItemReport, planItemImport, type ItemRow } from './itemImport'

const HEADER = ['STT', 'Tên danh mục', 'Mã mặt hàng', 'Tên mặt hàng', 'Giá mặt hàng', 'Tên đơn vị', 'Số lượng', 'Trọng lượng', 'Thời gian sử dụng', 'Tỉ lệ số lượng', 'Tiền hàng', 'Tỉ lệ tiền hàng', 'Tổng giảm giá', 'Tiền sau giảm giá']
const sheet = (rows: unknown[][], period = 'Từ ngày 00:00 01/10/2026 đến ngày 00:00 01/11/2026') => [
  ['Bún Đậu Em Thủy'], ['Thời gian xuất', '18:51 24/10/2026'], [], ['BÁO CÁO MẶT HÀNG'], [period], HEADER, ...rows,
]
const row = (n: string, cat: string, code: string, name: string, qty: number, gross: number, disc = 0) => [n, cat, code, name, '', '', qty, 0, '', 0, gross, 0, disc, gross - disc]
const item = (code: string, qty: number, net: number): ItemRow => ({ item_code: code, item_name: code, category: 'Đồ uống', qty, gross: net, discount: 0, net })

describe('đọc file báo cáo mặt hàng', () => {
  it('lấy tháng, ngày dữ liệu tính đến, vẫn giữ nhóm Bún bò (chỉ đếm là ẩn), nhóm "-" thành chưa có nhóm', () => {
    const p = parseItemReport(sheet([row('1', 'Đồ uống', 'DU01', 'Trà tắc', 97, 1455000, 75000), row('2', 'Bún bò', 'BBHN', 'Bún bò huế - Nạm', 76, 3040000), row('3', '-', 'CC', 'Chả Cua', 2, 40000), ['Tổng', '', '', '', '', '', 175]]))
    expect(p.month).toBe('2026-10-01')
    expect(p.periodStart).toBe('2026-10-01')
    expect(p.periodEnd).toBe('2026-10-24')
    expect(p.hidden).toBe(1)
    expect(p.items.map((i) => [i.item_code, i.category, i.qty, i.net])).toEqual([['DU01', 'Đồ uống', 97, 1380000], ['BBHN', 'Bún bò', 76, 3040000], ['CC', null, 2, 40000]])
  })

  it('nhận báo cáo một ngày hoặc một khoảng trong tháng', () => {
    const day = parseItemReport(sheet([row('1', 'Đồ uống', 'DU01', 'Trà tắc', 3, 45000)], 'Từ ngày 00:00 10/10/2026 đến ngày 00:00 11/10/2026'))
    expect([day.month, day.periodStart, day.periodEnd]).toEqual(['2026-10-01', '2026-10-10', '2026-10-10'])
  })

  it('từ chối báo cáo vượt một tháng', () => {
    expect(() => parseItemReport(sheet([], 'Từ ngày 00:00 01/10/2026 đến ngày 00:00 01/12/2026'))).toThrow('một tháng')
    expect(() => parseItemReport(sheet([], 'Từ ngày 00:00 28/10/2026 đến ngày 00:00 02/11/2026'))).toThrow('một tháng')
  })
})

describe('so mặt hàng với dữ liệu đã có', () => {
  const existing = [item('A', 10, 100), item('B', 5, 50)]
  it('thêm mới, bỏ qua trùng, báo khác', () => {
    const file = [item('A', 10, 100), item('B', 6, 60), item('C', 1, 10)]
    const keep = planItemImport(file, existing, false)
    expect(keep.identical).toBe(1)
    expect(keep.added.map((i) => i.item_code)).toEqual(['C'])
    expect(keep.changed.map((c) => [c.row.item_code, c.diffs.map((d) => `${d.label}:${d.before}->${d.after}`)])).toEqual([['B', ['Số phần:5->6', 'Tiền hàng:50->60', 'Doanh thu:50->60']]])
    expect(keep.toSend.map((i) => i.item_code)).toEqual(['C'])
    expect(planItemImport(file, existing, true).toSend.map((i) => i.item_code)).toEqual(['C', 'B'])
  })
})
