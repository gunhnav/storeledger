// Tổng kết mặt hàng bán theo tháng (quán Bún đậu): gom theo nhóm, xếp theo doanh thu.
import type { MonthlyItemSale } from '../types/database'

export const UNCATEGORIZED = 'Chưa phân loại'

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
