// Nguyên liệu của quán (chả cốm, chả ốc, giò...): trạng thái tồn, số ngày dùng được, định dạng số lượng.
// Tồn = tổng nhập - Σ(số phần đã bán × định lượng); số liệu do DB tính (get_ingredient_stock).

export type IngredientStatus = 'out' | 'low' | 'ok' | 'check'

// Hết (≤ 0), cần kiểm tra (âm: bán nhiều hơn đã nhập hoặc công thức sai), sắp hết (≤ ngưỡng), ổn
export function ingredientStatus(onHand: number, threshold: number): IngredientStatus {
  if (onHand < 0) return 'check'
  if (onHand === 0) return 'out'
  if (threshold > 0 && onHand <= threshold) return 'low'
  return 'ok'
}

// Số ngày còn dùng được theo tốc độ dùng của `days` ngày gần nhất; null khi chưa dùng gì (không ước tính được)
export function daysLeft(onHand: number, usedRecent: number, days: number): number | null {
  if (onHand <= 0) return 0
  if (!(usedRecent > 0) || days <= 0) return null
  return Math.floor(onHand / (usedRecent / days))
}

// 12 -> "12", 2.5 -> "2,5" (tối đa 2 số lẻ, bỏ số 0 thừa)
export function formatQty(n: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n)
}

// Gom các dòng công thức cùng nguyên liệu (cộng định lượng) và bỏ dòng trống / không hợp lệ
export function normalizeRecipeLines(lines: { ingredient_id: string; qty: string }[]): { ingredient_id: string; qty: number }[] {
  const merged = new Map<string, number>()
  for (const l of lines) {
    const qty = Number(l.qty.replace(',', '.'))
    if (!l.ingredient_id || !(qty > 0)) continue
    merged.set(l.ingredient_id, (merged.get(l.ingredient_id) ?? 0) + qty)
  }
  return [...merged].map(([ingredient_id, qty]) => ({ ingredient_id, qty: Math.round(qty * 1000) / 1000 }))
}
