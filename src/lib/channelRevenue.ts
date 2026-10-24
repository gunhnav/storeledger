// Doanh thu bán hàng chia theo kênh (Hogi): Quán, Công ty và ShopeeFood (kênh cũ, đơn cũ vẫn còn trong DB).
import type { SaleChannel } from '../types/database'

export const SALE_CHANNELS: SaleChannel[] = ['in_store', 'company', 'shopeefood']
export const saleChannelLabel = (c: SaleChannel) => (c === 'company' ? 'Công ty' : c === 'shopeefood' ? 'ShopeeFood (cũ)' : 'Quán')

export type SaleLite = { sale_date: string; channel: SaleChannel; total_amount: number }
export type ChannelDay = { date: string; byChannel: Record<SaleChannel, number>; total: number }
export type ChannelSummary = {
  total: number
  orders: number
  byChannel: Record<SaleChannel, { amount: number; orders: number }>
  // Mỗi ngày có đơn, cũ trước
  days: ChannelDay[]
}

const zero = (): Record<SaleChannel, number> => ({ in_store: 0, company: 0, shopeefood: 0 })

export function summarizeByChannel(sales: SaleLite[]): ChannelSummary {
  const days = new Map<string, ChannelDay>()
  const byChannel: ChannelSummary['byChannel'] = { in_store: { amount: 0, orders: 0 }, company: { amount: 0, orders: 0 }, shopeefood: { amount: 0, orders: 0 } }
  for (const s of sales) {
    const amount = Number(s.total_amount)
    const d = days.get(s.sale_date) ?? { date: s.sale_date, byChannel: zero(), total: 0 }
    d.byChannel[s.channel] += amount
    d.total += amount
    days.set(s.sale_date, d)
    byChannel[s.channel].amount += amount
    byChannel[s.channel].orders += 1
  }
  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { total: list.reduce((t, d) => t + d.total, 0), orders: sales.length, byChannel, days: list }
}
