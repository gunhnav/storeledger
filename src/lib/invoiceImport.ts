// Nhập file "Doanh thu theo danh sách hóa đơn" của máy POS: đọc file, so với hoá đơn đã có (khoá = mã hoá đơn),
// chỉ thêm hoá đơn mới, hoá đơn đã có mà khác thông tin thì cảnh báo và chỉ ghi đè khi người dùng đồng ý.
import type { DailyRevenue, RevenueInvoice } from '../types/database'

export type InvoiceRow = Pick<
  RevenueInvoice,
  'invoice_code' | 'status' | 'source' | 'payment_method' | 'channel' | 'revenue_date' | 'created_time' | 'paid_time' | 'goods_total' | 'discount' | 'total_paid'
>

export type ParsedInvoices = { invoices: InvoiceRow[]; unsupported: number }

const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()

// Số ngày Excel (46318,7174) → '2026-10-23 17:12:07' (giờ địa phương, không đổi múi giờ)
export function excelToLocal(serial: unknown): string | null {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 1) return null
  const ms = Math.round(serial * 86400) * 1000
  const d = new Date(Date.UTC(1899, 11, 30) + ms)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0)
const text = (v: unknown) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

export function parseInvoices(rows: unknown[][]): ParsedInvoices {
  const headerAt = rows.findIndex((r) => r.some((c) => norm(c) === 'ma hoa don'))
  if (headerAt < 0) throw new Error('Không phải file "Doanh thu theo danh sách hóa đơn" (không thấy cột Mã hóa đơn)')
  const header = rows[headerAt].map(norm)
  const col = (prefix: string) => header.findIndex((h) => h.startsWith(prefix))
  const c = {
    code: col('ma hoa don'),
    source: col('nguon don'),
    status: col('trang thai'),
    created: col('thoi gian tao'),
    paid: col('thoi gian thanh toan'),
    goods: col('tong tien hang'),
    discount: col('tong giam gia'),
    total: col('tong tien thanh toan'),
    method: col('phuong thuc'),
  }
  const missing = Object.entries(c).filter(([k, v]) => v < 0 && k !== 'source' && k !== 'method' && k !== 'paid')
  if (missing.length) throw new Error('File thiếu cột: ' + missing.map(([k]) => k).join(', '))

  const invoices: InvoiceRow[] = []
  const seen = new Set<string>()
  let unsupported = 0
  for (const r of rows.slice(headerAt + 1)) {
    const code = text(r[c.code])
    if (!code) continue
    const status = text(r[c.status])
    if (status !== 'Đã thanh toán' && status !== 'Đã hủy') {
      unsupported++
      continue
    }
    if (seen.has(code)) throw new Error(`Mã hóa đơn bị lặp trong file: ${code}`)
    seen.add(code)
    const created = excelToLocal(r[c.created])
    const paid = c.paid >= 0 ? excelToLocal(r[c.paid]) : null
    const date = (paid ?? created)?.slice(0, 10)
    if (!date) throw new Error(`Hóa đơn ${code} không có thời gian`)
    const source = c.source >= 0 ? text(r[c.source]) : null
    invoices.push({
      invoice_code: code,
      status,
      source,
      payment_method: c.method >= 0 ? text(r[c.method]) : null,
      channel: source === 'ShopeeFood' ? 'shopeefood' : 'in_store',
      revenue_date: date,
      created_time: created,
      paid_time: paid,
      goods_total: num(r[c.goods]),
      discount: num(r[c.discount]),
      total_paid: num(r[c.total]),
    })
  }
  if (invoices.length === 0) throw new Error('File không có hóa đơn nào')
  return { invoices, unsupported }
}

// So sánh một hoá đơn trong file với hoá đơn đã lưu; trả về tên các trường khác nhau
const FIELD_LABELS: Record<string, string> = {
  status: 'Trạng thái',
  source: 'Nguồn đơn',
  payment_method: 'Thanh toán',
  channel: 'Kênh',
  revenue_date: 'Ngày',
  created_time: 'Giờ tạo',
  paid_time: 'Giờ thanh toán',
  goods_total: 'Tiền hàng',
  discount: 'Giảm giá',
  total_paid: 'Tiền thanh toán',
}
const dbTime = (v: string | null) => (v ? v.replace('T', ' ').slice(0, 19) : null)
const same = (a: unknown, b: unknown) => (typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 0.005 : (a ?? null) === (b ?? null))

export function diffInvoice(file: InvoiceRow, saved: InvoiceRow): { field: string; label: string; before: string; after: string }[] {
  const out = []
  const savedNorm: InvoiceRow = { ...saved, created_time: dbTime(saved.created_time), paid_time: dbTime(saved.paid_time) }
  for (const field of Object.keys(FIELD_LABELS) as (keyof InvoiceRow)[]) {
    if (!same(file[field], savedNorm[field])) out.push({ field, label: FIELD_LABELS[field], before: String(savedNorm[field] ?? '—'), after: String(file[field] ?? '—') })
  }
  return out
}

export type DailyImpact = {
  date: string
  channel: DailyRevenue['channel']
  // Doanh thu ngày đang lưu (null = chưa có dòng) và sau khi nhập
  before: number | null
  after: number
  // update: tăng / giảm do hoá đơn nhập thêm, doanh thu đang lưu khớp hoá đơn đã có;
  // overwrite: dòng doanh thu đang lưu KHÔNG khớp hoá đơn đã có (nhập tay), nhập xong sẽ bị thay bằng tổng hoá đơn
  kind: 'new' | 'update' | 'overwrite'
}

export type InvoicePlan = {
  added: InvoiceRow[]
  identical: number
  changed: { row: InvoiceRow; diffs: ReturnType<typeof diffInvoice> }[]
  // Các hoá đơn sẽ gửi lên: mới + (nếu cho ghi đè) hoá đơn đã đổi
  toSend: InvoiceRow[]
  impacts: DailyImpact[]
}

const keyOf = (date: string, channel: string) => `${date}|${channel}`

export function planInvoiceImport(
  parsed: InvoiceRow[],
  existing: InvoiceRow[],
  dailyRows: Pick<DailyRevenue, 'revenue_date' | 'channel' | 'amount'>[],
  overwrite: boolean,
): InvoicePlan {
  const saved = new Map(existing.map((e) => [e.invoice_code, e]))
  const added: InvoiceRow[] = []
  const changed: InvoicePlan['changed'] = []
  let identical = 0
  for (const row of parsed) {
    const old = saved.get(row.invoice_code)
    if (!old) added.push(row)
    else {
      const diffs = diffInvoice(row, old)
      if (diffs.length === 0) identical++
      else changed.push({ row, diffs })
    }
  }
  const toSend = overwrite ? [...added, ...changed.map((c) => c.row)] : added

  const keys = new Set<string>()
  for (const r of toSend) {
    keys.add(keyOf(r.revenue_date, r.channel))
    const old = saved.get(r.invoice_code)
    if (old) keys.add(keyOf(old.revenue_date, old.channel))
  }
  const after = new Map(saved)
  for (const r of toSend) after.set(r.invoice_code, r)
  const paidSum = (m: Map<string, InvoiceRow>, key: string) => {
    let sum = 0
    let n = 0
    for (const i of m.values()) {
      if (i.status !== 'Đã thanh toán' || keyOf(i.revenue_date, i.channel) !== key) continue
      sum += Number(i.total_paid)
      n++
    }
    return { sum, n }
  }
  const daily = new Map(dailyRows.map((d) => [keyOf(d.revenue_date, d.channel), Number(d.amount)]))
  const impacts: DailyImpact[] = []
  for (const key of [...keys].sort()) {
    const next = paidSum(after, key)
    if (next.n === 0) continue
    const prevInvoices = paidSum(saved, key)
    const stored = daily.get(key) ?? null
    const [date, channel] = key.split('|') as [string, DailyRevenue['channel']]
    if (stored !== null && Math.abs(stored - next.sum) < 0.005) continue
    impacts.push({
      date,
      channel,
      before: stored,
      after: next.sum,
      kind: stored === null ? 'new' : Math.abs(stored - prevInvoices.sum) < 0.005 ? 'update' : 'overwrite',
    })
  }
  return { added, identical, changed, toSend, impacts }
}
