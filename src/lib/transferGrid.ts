// Lưới "Mang ra quán": mỗi cột một ngày, mỗi hàng một món đếm tồn, mỗi ô là số hũ mang thêm ra quầy.
// Chỉ tính số lượng (không có giá vốn) nên nhân viên dùng được.
import { addDays, MAX_QTY } from './format'

export type GridEntry = { productId: string; date: string; qty: number }
export type CellError = { key: string; reason: 'not_integer' | 'too_large' | 'future' }

export const cellKey = (productId: string, date: string) => `${productId}|${date}`

export function splitKey(key: string): { productId: string; date: string } {
  const i = key.lastIndexOf('|')
  return { productId: key.slice(0, i), date: key.slice(i + 1) }
}

// `days` ngày liên tiếp kết thúc ở `end` (cũ bên trái, mới bên phải)
export function gridDates(end: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(end, i - days + 1))
}

// Tổng số đã mang ra theo ô (món × ngày) từ các lần chuyển đã lưu
export function movedByCell(transfers: { productId: string; date: string; qty: number }[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const t of transfers) {
    const key = cellKey(t.productId, t.date)
    map.set(key, (map.get(key) ?? 0) + t.qty)
  }
  return map
}

// Đọc các ô đã gõ: ô trống / 0 bỏ qua; số lẻ, âm, quá lớn là lỗi (nếu truyền today thì chặn thêm ngày tương lai).
// Kết quả sắp theo ngày tăng dần để lưu ngày cũ trước.
export function parseEntries(inputs: Record<string, string>, today?: string): { entries: GridEntry[]; errors: CellError[] } {
  const entries: GridEntry[] = []
  const errors: CellError[] = []
  for (const [key, raw] of Object.entries(inputs)) {
    const text = raw.trim()
    if (text === '' || Number(text) === 0) continue
    const qty = Number(text)
    const { productId, date } = splitKey(key)
    if (!Number.isInteger(qty) || qty < 0) errors.push({ key, reason: 'not_integer' })
    else if (qty > MAX_QTY) errors.push({ key, reason: 'too_large' })
    else if (today && date > today) errors.push({ key, reason: 'future' })
    else entries.push({ productId, date, qty })
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.productId.localeCompare(b.productId))
  return { entries, errors }
}

// Tổng hũ định mang ra của từng món
export function totalsByProduct(entries: GridEntry[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of entries) map.set(e.productId, (map.get(e.productId) ?? 0) + e.qty)
  return map
}

// Món mà tổng định mang ra vượt số đang ở nhà (DB còn chặn thêm lô nhập sau ngày chuyển)
export function overHome(entries: GridEntry[], home: Map<string, number>): { productId: string; want: number; home: number }[] {
  return [...totalsByProduct(entries)]
    .map(([productId, want]) => ({ productId, want, home: home.get(productId) ?? 0 }))
    .filter((r) => r.want > r.home)
}
