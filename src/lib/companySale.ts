// Kênh Công ty: bán set mix nhiều loại theo giá thoả thuận (số set × giá 1 set), không theo giá tại quầy.
// DB lưu đơn giá từng dòng, nên tổng tiền set được chia cho từng loại theo tỷ lệ giá tại quầy × số hũ
// để báo cáo theo loại vẫn hợp lý. Đơn giá làm tròn 2 chữ số như cột sale_items.unit_price.

export type SetLine = { productId: string; qty: number; weight: number }

const round2 = (v: number) => Math.round(v * 100) / 100

// Tổng tiền đơn công ty
export function setTotal(sets: number, setPrice: number): number {
  return sets * setPrice
}

// Đơn giá từng loại sao cho Σ số lượng × đơn giá ≈ tổng tiền (lệch dưới 1 đồng do làm tròn).
// weight = giá tại quầy của loại; loại chưa có giá (0) hoặc tất cả 0 thì chia đều theo số hũ.
export function allocateSetTotal(total: number, lines: SetLine[]): Map<string, number> {
  const valid = lines.filter((l) => l.qty > 0)
  const allZero = valid.every((l) => l.weight <= 0)
  const weightOf = (l: SetLine) => l.qty * (allZero ? 1 : Math.max(l.weight, 0))
  const sum = valid.reduce((s, l) => s + weightOf(l), 0)
  const prices = new Map<string, number>()
  if (sum === 0) return prices
  for (const l of valid) prices.set(l.productId, round2((total * weightOf(l)) / sum / l.qty))

  // Bù phần lệch do làm tròn vào dòng có số lượng nhỏ nhất (đổi đơn giá 0,01 đ thì tổng đổi ít nhất)
  const allocated = valid.reduce((s, l) => s + l.qty * (prices.get(l.productId) ?? 0), 0)
  const diffCents = Math.round((total - allocated) * 100)
  const smallest = [...valid].filter((l) => weightOf(l) > 0).sort((a, b) => a.qty - b.qty)[0]
  if (diffCents !== 0 && smallest) {
    const step = Math.trunc(diffCents / smallest.qty)
    if (step !== 0) prices.set(smallest.productId, round2((prices.get(smallest.productId) ?? 0) + step / 100))
  }
  return prices
}

// Tổng thực lưu vào DB với các đơn giá đã chia
export function allocatedTotal(lines: SetLine[], prices: Map<string, number>): number {
  return round2(lines.reduce((s, l) => s + l.qty * (prices.get(l.productId) ?? 0), 0))
}
