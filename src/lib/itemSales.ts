// Tổng kết mặt hàng bán theo tháng (quán Bún đậu): gom theo nhóm, xếp theo doanh thu.
import type { MonthlyItemSale } from '../types/database'

export const UNCATEGORIZED = 'Chưa phân loại'

// Nhóm vẫn lưu (để đối chiếu với doanh thu) nhưng không hiện ở danh sách và tổng mặt hàng
export const HIDDEN_CATEGORIES = ['Bún bò']
export const isHidden = (r: Pick<MonthlyItemSale, 'category'>) => HIDDEN_CATEGORIES.includes(r.category?.trim() ?? '')
export const visibleItems = <T extends Pick<MonthlyItemSale, 'category'>>(rows: T[]) => rows.filter((r) => !isHidden(r))

export type ItemGroup = { category: string; items: MonthlyItemSale[]; qty: number; net: number }
export type ItemTotals = { items: number; qty: number; gross: number; discount: number; net: number }

type Row = Pick<MonthlyItemSale, 'category' | 'item_name' | 'item_code' | 'qty' | 'gross' | 'discount' | 'net'>

export function totalsOf(rows: Row[]): ItemTotals {
  return rows.reduce(
    (t, r) => ({
      items: t.items + 1,
      qty: t.qty + Number(r.qty),
      gross: t.gross + Number(r.gross),
      discount: t.discount + Number(r.discount),
      net: t.net + Number(r.net),
    }),
    { items: 0, qty: 0, gross: 0, discount: 0, net: 0 },
  )
}

// Nhóm có doanh thu cao đứng trước; trong nhóm, món doanh thu cao đứng trước (bằng nhau thì theo số lượng)
export function groupItems(rows: MonthlyItemSale[]): ItemGroup[] {
  const map = new Map<string, MonthlyItemSale[]>()
  for (const r of rows) {
    const key = r.category?.trim() || UNCATEGORIZED
    map.set(key, [...(map.get(key) ?? []), r])
  }
  return [...map]
    .map(([category, items]) => {
      const sorted = [...items].sort((a, b) => Number(b.net) - Number(a.net) || Number(b.qty) - Number(a.qty))
      return { category, items: sorted, qty: sorted.reduce((s, r) => s + Number(r.qty), 0), net: sorted.reduce((s, r) => s + Number(r.net), 0) }
    })
    .sort((a, b) => b.net - a.net)
}

// Chỉ giữ dòng có tên hoặc mã chứa từ khoá (không phân biệt hoa thường, dấu)
const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd')
export function filterItems<T extends Pick<MonthlyItemSale, 'item_name' | 'item_code'>>(rows: T[], query: string): T[] {
  const q = norm(query.trim())
  return q ? rows.filter((r) => norm(r.item_name).includes(q) || norm(r.item_code).includes(q)) : rows
}

// ---------------------------------------------------------------------------
// Xem theo ngày: báo cáo POS một ngày có period_start = period_end
// ---------------------------------------------------------------------------

export const isDayRow = (r: Pick<MonthlyItemSale, 'period_start' | 'period_end'>) => r.period_start === r.period_end

export type DayBlock = { date: string; groups: ItemGroup[]; qty: number; net: number }

export type ItemFilter = { from?: string; to?: string; category?: string; query?: string }

// Giữ dòng trong khoảng ngày (theo period_start), đúng nhóm và khớp từ khoá
export function applyFilter(rows: MonthlyItemSale[], f: ItemFilter): MonthlyItemSale[] {
  const byDate = rows.filter((r) => (!f.from || r.period_start >= f.from) && (!f.to || r.period_start <= f.to))
  const byCat = f.category ? byDate.filter((r) => (r.category?.trim() || UNCATEGORIZED) === f.category) : byDate
  return filterItems(byCat, f.query ?? '')
}

// Mỗi ngày một khối (ngày mới nhất trước), mỗi khối gom theo nhóm
export function groupByDay(rows: MonthlyItemSale[]): DayBlock[] {
  const byDate = new Map<string, MonthlyItemSale[]>()
  for (const r of rows) byDate.set(r.period_start, [...(byDate.get(r.period_start) ?? []), r])
  return [...byDate]
    .map(([date, items]) => ({ date, groups: groupItems(items), qty: totalsOf(items).qty, net: totalsOf(items).net }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

// Cộng các ngày lại theo mã mặt hàng (một dòng mỗi mặt hàng)
export function mergeItems(rows: MonthlyItemSale[]): MonthlyItemSale[] {
  const merged = new Map<string, MonthlyItemSale>()
  for (const r of rows) {
    const m = merged.get(r.item_code)
    merged.set(
      r.item_code,
      m
        ? { ...m, qty: Number(m.qty) + Number(r.qty), gross: Number(m.gross) + Number(r.gross), discount: Number(m.discount) + Number(r.discount), net: Number(m.net) + Number(r.net) }
        : { ...r },
    )
  }
  return [...merged.values()]
}

// Các nhóm có trong dữ liệu (để làm bộ lọc nhóm), nhóm doanh thu cao đứng trước
export function categoriesOf(rows: MonthlyItemSale[]): string[] {
  return groupItems(rows).map((g) => g.category)
}

// ---------------------------------------------------------------------------
// Đối chiếu: trong cùng khoảng ngày, doanh thu phải bằng tổng "tiền sau giảm giá" của mọi mặt hàng (kể cả nhóm ẩn)
// ---------------------------------------------------------------------------

export type Mismatch = { start: string; end: string; revenue: number; items: number; diff: number }
const TOLERANCE = 1

// rows: dòng mặt hàng (đã có period_start / period_end); revenueByDate: doanh thu mỗi ngày (mọi kênh).
// Bỏ qua khoảng không có doanh thu nào lẫn không có mặt hàng; ngày có một bên mà thiếu bên kia vẫn báo.
export function reconcile(
  rows: Pick<MonthlyItemSale, 'period_start' | 'period_end' | 'net'>[],
  revenueByDate: Map<string, number>,
): Mismatch[] {
  const periods = new Map<string, { start: string; end: string; items: number }>()
  for (const r of rows) {
    const key = `${r.period_start}|${r.period_end}`
    const p = periods.get(key) ?? { start: r.period_start, end: r.period_end, items: 0 }
    p.items += Number(r.net)
    periods.set(key, p)
  }
  const out: Mismatch[] = []
  for (const p of [...periods.values()].sort((a, b) => b.start.localeCompare(a.start))) {
    let revenue = 0
    for (const [date, amount] of revenueByDate) if (date >= p.start && date <= p.end) revenue += amount
    const diff = revenue - p.items
    if (Math.abs(diff) > TOLERANCE) out.push({ start: p.start, end: p.end, revenue, items: p.items, diff })
  }
  return out
}
