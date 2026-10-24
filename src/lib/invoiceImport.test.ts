import { describe, expect, it } from 'vitest'
import { excelToLocal, parseInvoices, planInvoiceImport, type InvoiceRow } from './invoiceImport'

const HEADER = ['Stt', 'Mã hóa đơn', 'Nguồn đơn', 'Trạng thái đơn hàng', 'Thời gian tạo đơn', 'Thời gian thanh toán', 'Cấu hình giá', 'Tổng tiền hàng \n(1)', 'Thuế VAT', 'Phí dịch vụ', 'Tổng giảm giá \n(4)', 'Phí GH', 'Tổng tiền thanh toán \n(1 + 2 + 3 - 4 + 5)', 'Phương thức TT']
const line = (code: string, status: string, serial: number, total: number, source: string | null = 'Tại nhà hàng', discount = 0) =>
  [1, code, source, status, serial, serial, '', total + discount, 0, 0, discount, 0, total, source === 'ShopeeFood' ? 'ShopeeFood' : 'Tiền mặt']

const inv = (code: string, date: string, total: number, extra: Partial<InvoiceRow> = {}): InvoiceRow => ({
  invoice_code: code, status: 'Đã thanh toán', source: 'Tại nhà hàng', payment_method: 'Tiền mặt', channel: 'in_store', revenue_date: date,
  created_time: `${date} 10:00:00`, paid_time: `${date} 10:00:00`, goods_total: total, discount: 0, total_paid: total, ...extra,
})

describe('đọc file hoá đơn', () => {
  it('đổi số ngày Excel sang giờ địa phương', () => {
    expect(excelToLocal(46318.75268518519)).toBe('2026-10-23 18:03:52')
    expect(excelToLocal('x')).toBeNull()
  })

  it('đọc hoá đơn, nhận kênh ShopeeFood, giữ đơn huỷ, bỏ dòng tiêu đề phụ', () => {
    const p = parseInvoices([['DOANH THU THEO DANH SÁCH HÓA ĐƠN'], [], HEADER, line('A1', 'Đã thanh toán', 46318.5, 70000), line('A2', 'Đã hủy', 46318.6, 40000), line('A3', 'Đã thanh toán', 46319.1, 26999, 'ShopeeFood', 1)])
    expect(p.invoices.map((i) => [i.invoice_code, i.status, i.channel, i.revenue_date, i.total_paid])).toEqual([
      ['A1', 'Đã thanh toán', 'in_store', '2026-10-23', 70000],
      ['A2', 'Đã hủy', 'in_store', '2026-10-23', 40000],
      ['A3', 'Đã thanh toán', 'shopeefood', '2026-10-24', 26999],
    ])
    expect(p.invoices[2].discount).toBe(1)
  })

  it('báo lỗi khi sai file hoặc lặp mã', () => {
    expect(() => parseInvoices([['a', 'b']])).toThrow('Mã hóa đơn')
    expect(() => parseInvoices([HEADER, line('A1', 'Đã thanh toán', 46318.5, 1), line('A1', 'Đã thanh toán', 46318.5, 1)])).toThrow('lặp')
  })
})

describe('so hoá đơn với dữ liệu đã có', () => {
  const existing = [inv('A1', '2026-10-01', 100), inv('A2', '2026-10-01', 50)]
  const daily = [{ revenue_date: '2026-10-01', channel: 'in_store' as const, amount: 150 }]

  it('chỉ thêm hoá đơn mới, bỏ qua hoá đơn trùng y hệt', () => {
    const plan = planInvoiceImport([inv('A1', '2026-10-01', 100), inv('A3', '2026-10-01', 30)], existing, daily, false)
    expect(plan.identical).toBe(1)
    expect(plan.added.map((i) => i.invoice_code)).toEqual(['A3'])
    expect(plan.toSend).toHaveLength(1)
    expect(plan.impacts).toEqual([{ date: '2026-10-01', channel: 'in_store', before: 150, after: 180, kind: 'update' }])
  })

  it('hoá đơn đã có mà khác thì báo khác gì và không gửi nếu chưa cho ghi đè', () => {
    const file = [inv('A2', '2026-10-01', 70)]
    const keep = planInvoiceImport(file, existing, daily, false)
    expect(keep.changed).toHaveLength(1)
    expect(keep.changed[0].diffs.map((d) => [d.label, d.before, d.after])).toEqual([['Tiền hàng', '50', '70'], ['Tiền thanh toán', '50', '70']])
    expect(keep.toSend).toHaveLength(0)
    expect(keep.impacts).toEqual([])
    const over = planInvoiceImport(file, existing, daily, true)
    expect(over.toSend).toHaveLength(1)
    expect(over.impacts[0]).toMatchObject({ before: 150, after: 170, kind: 'update' })
  })

  it('doanh thu nhập tay không khớp hoá đơn thì cảnh báo sẽ bị đè; ngày chưa có thì là mới', () => {
    const plan = planInvoiceImport([inv('B1', '2026-10-02', 40), inv('C1', '2026-10-03', 10)], [], [{ revenue_date: '2026-10-02', channel: 'in_store', amount: 999 }], false)
    expect(plan.impacts).toEqual([
      { date: '2026-10-02', channel: 'in_store', before: 999, after: 40, kind: 'overwrite' },
      { date: '2026-10-03', channel: 'in_store', before: null, after: 10, kind: 'new' },
    ])
  })

  it('đơn huỷ không cộng vào doanh thu ngày', () => {
    const plan = planInvoiceImport([inv('X1', '2026-10-05', 80, { status: 'Đã hủy' })], [], [], false)
    expect(plan.added).toHaveLength(1)
    expect(plan.impacts).toEqual([])
  })
})
