// Báo cáo chi phí theo nhóm: tổng từng nhóm, tỷ trọng, so với kỳ trước, chi phí cố định.
import { FIXED_GROUPS } from './expenses'

export type ExpenseLike = { category: string; amount: number }
export type GroupRow = { category: string; amount: number; count: number; share: number; previous: number }

// Mỗi nhóm một dòng (số tiền cao đứng trước). Nhóm chỉ có ở kỳ trước vẫn hiện (số tiền 0) để thấy khoản đã giảm về 0.
export function expenseByGroup(current: ExpenseLike[], previous: ExpenseLike[] = []): GroupRow[] {
  const sum = (rows: ExpenseLike[]) => {
    const m = new Map<string, { amount: number; count: number }>()
    for (const r of rows) {
      const g = m.get(r.category) ?? { amount: 0, count: 0 }
      g.amount += Number(r.amount)
      g.count += 1
      m.set(r.category, g)
    }
    return m
  }
  const cur = sum(current)
  const prev = sum(previous)
  const total = [...cur.values()].reduce((s, g) => s + g.amount, 0)
  return [...new Set([...cur.keys(), ...prev.keys()])]
    .map((category) => {
      const c = cur.get(category) ?? { amount: 0, count: 0 }
      return { category, amount: c.amount, count: c.count, share: total > 0 ? c.amount / total : 0, previous: prev.get(category)?.amount ?? 0 }
    })
    .sort((a, b) => b.amount - a.amount || b.previous - a.previous)
}

export const totalOf = (rows: ExpenseLike[]) => rows.reduce((s, r) => s + Number(r.amount), 0)

// Chi phí cố định hằng tháng (tiền nhà, điện nước, lương) trong danh sách khoản chi
export const fixedTotal = (rows: ExpenseLike[]) => totalOf(rows.filter((r) => FIXED_GROUPS.includes(r.category)))

// Chi phí trên doanh thu (0,6 = 60%); null khi chưa có doanh thu
export const expenseRatio = (expenses: number, revenue: number): number | null => (revenue > 0 ? expenses / revenue : null)
