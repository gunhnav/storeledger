// Nhập file "Báo cáo mặt hàng" của máy POS (một tháng): so với tổng kết mặt hàng đã lưu của tháng đó (khoá = mã mặt hàng),
// chỉ thêm mặt hàng mới, mặt hàng đã có mà số liệu khác thì cảnh báo và chỉ ghi đè khi người dùng đồng ý.
import { HIDDEN_CATEGORIES } from './itemSales'
import type { MonthlyItemSale } from '../types/database'

export type ItemRow = Pick<MonthlyItemSale, 'item_code' | 'item_name' | 'category' | 'qty' | 'gross' | 'discount' | 'net'>
export type ParsedItems = { month: string; periodStart: string; periodEnd: string; items: ItemRow[]; hidden: number }

const norm = (v: unknown) =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0)
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

export function parseItemReport(rows: unknown[][]): ParsedItems {
  const headerAt = rows.findIndex((r) => norm(r[0]) === 'stt' && r.some((c) => norm(c) === 'ma mat hang'))
  if (headerAt < 0) throw new Error('Không phải file "Báo cáo mặt hàng" (không thấy cột Mã mặt hàng)')

  const periodText = rows.slice(0, headerAt).map((r) => String(r[0] ?? '')).find((s) => /\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}/.test(s))
  const p = periodText?.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/)
  if (!p) throw new Error('Không đọc được khoảng ngày của báo cáo')
  const [fd, fm, fy, td, tm, ty] = p.slice(1).map(Number)
  const from = Date.UTC(fy, fm - 1, fd)
  const toExclusive = Date.UTC(ty, tm - 1, td)
  const monthEnd = Date.UTC(fy, fm, 1)
  if (toExclusive <= from || toExclusive > monthEnd) throw new Error('Báo cáo phải nằm trong một tháng')
  let end = new Date(toExclusive - 86400000)
  const exported = rows.slice(0, headerAt).find((r) => norm(r[0]) === 'thoi gian xuat')
  const e = String(exported?.[1] ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (e) {
    const exp = new Date(Date.UTC(Number(e[3]), Number(e[2]) - 1, Number(e[1])))
    if (exp < end) end = exp
  }
  if (end.getTime() < from) throw new Error('Báo cáo xuất trước ngày bắt đầu của khoảng ngày')

  const header = rows[headerAt].map(norm)
  const col = (name: string) => header.indexOf(name)
  const c = { cat: col('ten danh muc'), code: col('ma mat hang'), name: col('ten mat hang'), qty: col('so luong'), gross: col('tien hang'), discount: col('tong giam gia'), net: col('tien sau giam gia') }
  const missing = Object.entries(c).filter(([, v]) => v < 0)
  if (missing.length) throw new Error('File thiếu cột: ' + missing.map(([k]) => k).join(', '))

  const items: ItemRow[] = []
  const seen = new Set<string>()
  let hidden = 0
  for (const r of rows.slice(headerAt + 1)) {
    if (!/^\d+$/.test(String(r[0] ?? '').trim().replace(/\.0$/, ''))) continue
    const code = String(r[c.code] ?? '').trim()
    const name = String(r[c.name] ?? '').trim()
    if (!code || !name) continue
    const category = String(r[c.cat] ?? '').trim()
    // Nhóm ẩn vẫn được lưu để đối chiếu với doanh thu, chỉ không hiện ở danh sách mặt hàng
    if (HIDDEN_CATEGORIES.includes(category)) hidden++
    if (seen.has(code)) throw new Error(`Mã mặt hàng bị lặp trong file: ${code}`)
    seen.add(code)
    items.push({ item_code: code, item_name: name, category: category === '' || category === '-' ? null : category, qty: num(r[c.qty]), gross: num(r[c.gross]), discount: num(r[c.discount]), net: num(r[c.net]) })
  }
  if (items.length === 0) throw new Error('File không có mặt hàng nào')
  return { month: iso(fy, fm, 1), periodStart: iso(fy, fm, fd), periodEnd: iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()), items, hidden }
}

const LABELS: Record<string, string> = { item_name: 'Tên', category: 'Nhóm', qty: 'Số phần', gross: 'Tiền hàng', discount: 'Giảm giá', net: 'Doanh thu' }
const eq = (a: unknown, b: unknown) => (typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 0.005 : (a ?? null) === (b ?? null))

export type ItemPlan = {
  added: ItemRow[]
  identical: number
  changed: { row: ItemRow; diffs: { field: string; label: string; before: string; after: string }[] }[]
  toSend: ItemRow[]
}

export function planItemImport(parsed: ItemRow[], existing: ItemRow[], overwrite: boolean): ItemPlan {
  const saved = new Map(existing.map((e) => [e.item_code, e]))
  const added: ItemRow[] = []
  const changed: ItemPlan['changed'] = []
  let identical = 0
  for (const row of parsed) {
    const old = saved.get(row.item_code)
    if (!old) {
      added.push(row)
      continue
    }
    const diffs = (Object.keys(LABELS) as (keyof ItemRow)[])
      .filter((f) => !eq(row[f], old[f]))
      .map((f) => ({ field: f, label: LABELS[f], before: String(old[f] ?? '—'), after: String(row[f] ?? '—') }))
    if (diffs.length === 0) identical++
    else changed.push({ row, diffs })
  }
  return { added, identical, changed, toSend: overwrite ? [...added, ...changed.map((c) => c.row)] : added }
}
