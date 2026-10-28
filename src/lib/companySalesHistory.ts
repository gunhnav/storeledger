// Lịch sử bán hàng kênh Công ty: mỗi đơn một dòng (ngày, các vị đã bán, tổng hũ, giảm giá, tiền thu, ghi chú).

export type CompanySaleRow = {
  id: string
  sale_date: string
  total_amount: number
  discount_amount: number | null
  note: string | null
  created_at: string
  sale_items: { product_id: string; quantity: number; unit_price: number }[]
}

export type CompanySaleLine = {
  id: string
  date: string
  total: number
  discount: number
  note: string
  jars: number
  // Số hũ từng vị, vị bán nhiều nhất trước
  items: { productId: string; quantity: number }[]
}

export type CompanySalesSummary = { orders: number; jars: number; revenue: number; discount: number; lines: CompanySaleLine[] }

// Đơn mới nhất trước
export function summarizeCompanySales(rows: CompanySaleRow[]): CompanySalesSummary {
  const lines = rows
    .map((r): CompanySaleLine => {
      const byProduct = new Map<string, number>()
      for (const i of r.sale_items) byProduct.set(i.product_id, (byProduct.get(i.product_id) ?? 0) + Number(i.quantity))
      const items = [...byProduct].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => b.quantity - a.quantity)
      return {
        id: r.id,
        date: r.sale_date,
        total: Number(r.total_amount),
        discount: Number(r.discount_amount ?? 0),
        note: r.note?.trim() ?? '',
        jars: items.reduce((s, i) => s + i.quantity, 0),
        items,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  return {
    orders: lines.length,
    jars: lines.reduce((s, l) => s + l.jars, 0),
    revenue: lines.reduce((s, l) => s + l.total, 0),
    discount: lines.reduce((s, l) => s + l.discount, 0),
    lines,
  }
}
