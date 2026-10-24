// Định lượng nguyên vật liệu từng món (quán Bún đậu): dữ liệu để sau này tính tồn kho nguyên vật liệu theo doanh thu.
import type { DishRecipeLine } from '../types/database'

// "7 miếng Đậu", "10 Bún"; qty null (rau ăn kèm) chỉ hiện tên
export function lineText(l: Pick<DishRecipeLine, 'ingredient' | 'qty' | 'unit'>): string {
  if (l.qty === null) return l.ingredient
  const qty = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(l.qty))
  return [qty, l.unit, l.ingredient].filter(Boolean).join(' ')
}

// Lãi gộp một phần và biên lãi (0,5 = 50%); null khi chưa có giá vốn hoặc giá bán 0
export function recipeMargin(price: number, cost: number | null): { profit: number; pct: number } | null {
  if (cost === null || !(price > 0)) return null
  return { profit: price - cost, pct: (price - cost) / price }
}

// Cộng tổng định lượng theo nguyên liệu của số phần đã bán (dùng khi tính tồn kho): bỏ dòng không định lượng
export function usageFor(lines: Pick<DishRecipeLine, 'ingredient' | 'qty'>[], portions: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of lines) {
    if (l.qty === null) continue
    out.set(l.ingredient, (out.get(l.ingredient) ?? 0) + Number(l.qty) * portions)
  }
  return out
}
