// Doanh thu nhập tay theo ngày + kênh (quán Bún đậu): hoa hồng đối tác và tổng hợp lãi theo kỳ.
import type { DailyRevenue } from '../types/database'

export type RevenueChannel = DailyRevenue['channel']
export const REVENUE_CHANNELS: RevenueChannel[] = ['in_store', 'shopeefood', 'nem_cuon']

export const channelLabel = (channel: RevenueChannel) => (channel === 'shopeefood' ? 'Đối tác (app)' : channel === 'nem_cuon' ? 'Bán nem cuốn' : 'Quán')

// Hoa hồng chỉ tính cho kênh đối tác, theo tỷ lệ mặc định của cửa hàng (0,25 = 25%)
export const commissionOf = (amount: number, channel: RevenueChannel, rate: number) =>
  channel === 'shopeefood' ? Math.round(amount * rate) : 0

export type RevenueDay = { date: string; gross: number; commission: number; expenses: number; byChannel: Record<RevenueChannel, number> }
export type RevenueSummary = {
  gross: number
  commission: number
  // Thực thu = doanh thu - hoa hồng
  net: number
  expenses: number
  profit: number
  byChannel: Record<RevenueChannel, number>
  // Mỗi ngày có doanh thu hoặc chi phí, cũ trước
  days: RevenueDay[]
}

export function summarize(
  revenue: Pick<DailyRevenue, 'revenue_date' | 'channel' | 'amount'>[],
  expenses: { expense_date: string; amount: number }[],
  rate: number,
): RevenueSummary {
  const days = new Map<string, RevenueDay>()
  const day = (date: string) => {
    let d = days.get(date)
    if (!d) days.set(date, (d = { date, gross: 0, commission: 0, expenses: 0, byChannel: { in_store: 0, shopeefood: 0, nem_cuon: 0 } }))
    return d
  }
  const byChannel: Record<RevenueChannel, number> = { in_store: 0, shopeefood: 0, nem_cuon: 0 }
  for (const r of revenue) {
    const amount = Number(r.amount)
    const d = day(r.revenue_date)
    d.gross += amount
    d.byChannel[r.channel] += amount
    d.commission += commissionOf(amount, r.channel, rate)
    byChannel[r.channel] += amount
  }
  for (const e of expenses) day(e.expense_date).expenses += Number(e.amount)

  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  const gross = list.reduce((s, d) => s + d.gross, 0)
  const commission = list.reduce((s, d) => s + d.commission, 0)
  const exp = list.reduce((s, d) => s + d.expenses, 0)
  return { gross, commission, net: gross - commission, expenses: exp, profit: gross - commission - exp, byChannel, days: list }
}
