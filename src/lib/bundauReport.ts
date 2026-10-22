// Báo cáo riêng cho quán Bún đậu: khoảng ngày, so với kỳ trước, giờ đông khách, gợi ý vận hành.
import { addDays, monthEnd, monthStart } from './format'
import { daysInclusive } from './analytics/core'
import { daysLeft, ingredientStatus } from './ingredients'
import type { BundauReport, IngredientStockRow } from '../types/database'

export type Preset = 'today' | '7d' | 'month' | 'lastMonth'
export type Range = { from: string; to: string }

export function presetRange(preset: Preset, today: string): Range {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case 'month':
      return { from: monthStart(today), to: today }
    case 'lastMonth':
      return { from: monthStart(today, -1), to: monthEnd(today, -1) }
  }
}

// Kỳ liền trước có cùng số ngày (để so sánh)
export function previousRange({ from, to }: Range): Range {
  const n = daysInclusive(from, to)
  const prevTo = addDays(from, -1)
  return { from: addDays(prevTo, -(n - 1)), to: prevTo }
}

// Thay đổi so với kỳ trước (0,15 = tăng 15%); null khi kỳ trước bằng 0 (không so được)
export function pctChange(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null
}

// Đủ 24 giờ, giờ không có đơn = 0; cắt phần đầu / cuối không có đơn nhưng luôn hiện tối thiểu 8h-21h
export function hourBuckets(hours: BundauReport['hours']): { hour: number; orders: number; gross: number }[] {
  const byHour = new Map(hours.map((h) => [h.hour, h]))
  const active = hours.filter((h) => h.orders > 0).map((h) => h.hour)
  const lo = Math.min(8, ...(active.length ? active : [8]))
  const hi = Math.max(21, ...(active.length ? active : [21]))
  const out = []
  for (let h = lo; h <= hi; h++) out.push({ hour: h, orders: byHour.get(h)?.orders ?? 0, gross: byHour.get(h)?.gross ?? 0 })
  return out
}

export type Insight = { tone: 'warn' | 'info' | 'good'; key: string; params?: Record<string, string | number> }

export type InsightInput = {
  report: BundauReport
  previous: BundauReport | null
  expenses: number
  // Chi phí nhóm Nguyên liệu trong kỳ
  ingredientExpenses: number
  ingredients: IngredientStockRow[]
  recentDays: number
  // Đồ uống: còn ở quán và ngưỡng
  drinks: { name: string; onHand: number; threshold: number }[]
  fmt: (v: number) => string
}

// Gợi ý ngắn cho chủ quán, theo luật đơn giản (không dùng AI): ưu tiên việc cần làm ngay
export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = []

  const out0 = i.ingredients.filter((g) => ingredientStatus(g.on_hand, g.low_stock_threshold) === 'out').map((g) => g.name)
  if (out0.length) out.push({ tone: 'warn', key: 'Nguyên liệu đã hết: {list}. Cần nhập ngay.', params: { list: out0.join(', ') } })

  const soon = i.ingredients
    .map((g) => ({ g, d: daysLeft(g.on_hand, g.used_recent, i.recentDays) }))
    .filter((x) => x.d !== null && x.d >= 1 && x.d <= 2)
    .map((x) => `${x.g.name} (~${x.d} ngày)`)
  if (soon.length) out.push({ tone: 'warn', key: 'Sắp hết trong 1-2 ngày theo tốc độ bán: {list}.', params: { list: soon.join(', ') } })

  const lowDrinks = i.drinks.filter((d) => d.onHand <= d.threshold).map((d) => d.name)
  if (lowDrinks.length) out.push({ tone: 'warn', key: 'Đồ uống sắp hết hoặc hết: {list}.', params: { list: lowDrinks.join(', ') } })

  const unlinked = i.ingredients.filter((g) => g.received > 0 && g.used === 0).map((g) => g.name)
  if (unlinked.length) out.push({ tone: 'info', key: 'Chưa có món nào dùng: {list}. Đặt công thức thì tồn mới tự giảm theo doanh thu.', params: { list: unlinked.join(', ') } })

  const t = i.report.totals
  if (t.orders === 0) {
    out.push({ tone: 'info', key: 'Chưa có đơn nào trong kỳ này.' })
    return out
  }

  const prev = i.previous?.totals.gross ?? 0
  const change = pctChange(t.gross, prev)
  if (change !== null && Math.abs(change) >= 0.1) {
    out.push({
      tone: change > 0 ? 'good' : 'warn',
      key: change > 0 ? 'Doanh thu tăng {pct}% so với kỳ trước.' : 'Doanh thu giảm {pct}% so với kỳ trước.',
      params: { pct: Math.round(Math.abs(change) * 100) },
    })
  }

  const top = i.report.top[0]
  if (top && t.gross > 0) {
    out.push({ tone: 'info', key: 'Món bán chạy nhất: {name} ({qty} phần, {pct}% doanh thu).', params: { name: top.name, qty: top.qty, pct: Math.round((top.revenue / t.gross) * 100) } })
  }

  const peak = [...i.report.hours].sort((a, b) => b.orders - a.orders)[0]
  if (peak && peak.orders >= 3) out.push({ tone: 'info', key: 'Giờ đông khách nhất: {hour}h. Chuẩn bị hàng và nhân sự trước giờ này.', params: { hour: peak.hour } })

  const partner = i.report.channels.find((c) => c.channel === 'shopeefood')
  if (partner && t.gross > 0 && partner.commission > 0) {
    const share = Math.round((partner.gross / t.gross) * 100)
    out.push({ tone: share >= 40 ? 'warn' : 'info', key: 'Kênh đối tác chiếm {pct}% doanh thu, hoa hồng đã trả {fee}.', params: { pct: share, fee: i.fmt(partner.commission) } })
  }

  if (t.gross > 0 && i.ingredientExpenses > 0) {
    const pct = Math.round((i.ingredientExpenses / t.gross) * 100)
    if (pct >= 45) out.push({ tone: 'warn', key: 'Tiền nguyên liệu chiếm {pct}% doanh thu, hơi cao. Kiểm tra giá nhập và định lượng mỗi phần.', params: { pct } })
  }

  if (t.discount > 0 && t.gross > 0) {
    const pct = Math.round((t.discount / (t.gross + t.discount)) * 100)
    if (pct >= 8) out.push({ tone: 'warn', key: 'Đã giảm giá {fee} ({pct}% tiền hàng). Xem lại mức ưu đãi.', params: { fee: i.fmt(t.discount), pct } })
  }

  if (!out.some((x) => x.tone === 'warn')) out.push({ tone: 'good', key: 'Mọi thứ đang ổn: chưa có cảnh báo tồn kho hay chi phí.' })
  return out
}
