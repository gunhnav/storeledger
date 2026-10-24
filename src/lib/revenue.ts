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

// ---------------------------------------------------------------------------
// Bảng "Chi tiết theo ngày" của báo cáo: bộ lọc riêng (khoảng ngày, kênh, sắp xếp)
// ---------------------------------------------------------------------------

export type DaySort = 'date_desc' | 'date_asc' | 'revenue_desc' | 'profit_desc'
export type DayFilter = { from: string; to: string; channel: RevenueChannel | ''; sort: DaySort }

export const dayProfit = (d: RevenueDay) => d.gross - d.commission - d.expenses
// Doanh thu của ngày theo kênh đang lọc (không lọc kênh = tổng các kênh)
export const dayRevenue = (d: RevenueDay, channel: RevenueChannel | '') => (channel === '' ? d.gross : d.byChannel[channel])

export function filterDays(days: RevenueDay[], f: DayFilter): RevenueDay[] {
  const kept = days.filter((d) => (!f.from || d.date >= f.from) && (!f.to || d.date <= f.to) && (f.channel === '' || d.byChannel[f.channel] > 0))
  const by: Record<DaySort, (a: RevenueDay, b: RevenueDay) => number> = {
    date_desc: (a, b) => b.date.localeCompare(a.date),
    date_asc: (a, b) => a.date.localeCompare(b.date),
    revenue_desc: (a, b) => dayRevenue(b, f.channel) - dayRevenue(a, f.channel) || b.date.localeCompare(a.date),
    profit_desc: (a, b) => dayProfit(b) - dayProfit(a) || b.date.localeCompare(a.date),
  }
  return [...kept].sort(by[f.sort])
}

export function sumDays(days: RevenueDay[]): Omit<RevenueDay, 'date'> {
  return days.reduce(
    (t, d) => ({
      gross: t.gross + d.gross,
      commission: t.commission + d.commission,
      expenses: t.expenses + d.expenses,
      byChannel: { in_store: t.byChannel.in_store + d.byChannel.in_store, shopeefood: t.byChannel.shopeefood + d.byChannel.shopeefood, nem_cuon: t.byChannel.nem_cuon + d.byChannel.nem_cuon },
    }),
    { gross: 0, commission: 0, expenses: 0, byChannel: { in_store: 0, shopeefood: 0, nem_cuon: 0 } },
  )
}
