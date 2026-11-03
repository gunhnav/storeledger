// Lịch tháng bán hàng (tab Nhật ký ngày): mỗi ngày tổng số hũ từng loại đã bán,
// bấm vào ngày thì tách Quán (hũ từng loại) và Công ty (số set, hũ từng loại, ghi chú từng đơn).

import { addDays, monthEnd, monthStart } from './format'
import type { SaleChannel } from '../types/database'

export type CalendarSaleRow = {
  id: string
  sale_date: string
  channel: SaleChannel
  total_amount: number
  note: string | null
  sale_items: { product_id: string; quantity: number }[]
}

export type CalendarOrder = {
  id: string
  total: number
  note: string
  // Số set đọc từ ghi chú đơn Công ty; null nếu không đọc được
  sets: number | null
  items: Map<string, number>
}

export type CalendarDay = {
  date: string
  total: Map<string, number>
  shop: Map<string, number>
  shopOrders: CalendarOrder[]
  company: Map<string, number>
  companySets: number
  companyOrders: CalendarOrder[]
}

// Ghi chú đơn Công ty dạng "1 set 4 (…) × 55.000 ₫ + 2 set 6 (…) × 70.000 ₫ · tên khách"
export function setCountFromNote(note: string | null): number | null {
  if (!note) return null
  const matches = [...note.matchAll(/(\d+)\s+set\s+\d+\s*\(/gi)]
  if (matches.length === 0) return null
  return matches.reduce((s, m) => s + Number(m[1]), 0)
}

// Phần ghi chú do người nhập gõ thêm (sau dấu " · "); đơn không có phần set thì giữ nguyên
export function customerNote(note: string | null): string {
  const text = note?.trim() ?? ''
  if (setCountFromNote(text) === null) return text
  const i = text.indexOf(' · ')
  return i < 0 ? '' : text.slice(i + 3).trim()
}

const add = (m: Map<string, number>, id: string, qty: number) => m.set(id, (m.get(id) ?? 0) + qty)

export function summarizeByDay(rows: CalendarSaleRow[]): Map<string, CalendarDay> {
  const days = new Map<string, CalendarDay>()
  const sorted = [...rows].sort((a, b) => a.sale_date.localeCompare(b.sale_date) || a.id.localeCompare(b.id))
  for (const r of sorted) {
    let day = days.get(r.sale_date)
    if (!day) {
      day = { date: r.sale_date, total: new Map(), shop: new Map(), shopOrders: [], company: new Map(), companySets: 0, companyOrders: [] }
      days.set(r.sale_date, day)
    }
    const items = new Map<string, number>()
    for (const i of r.sale_items) add(items, i.product_id, Number(i.quantity))
    const isCompany = r.channel === 'company'
    const order: CalendarOrder = {
      id: r.id,
      total: Number(r.total_amount),
      note: r.note?.trim() ?? '',
      sets: isCompany ? setCountFromNote(r.note) : null,
      items,
    }
    for (const [id, qty] of items) {
      add(day.total, id, qty)
      add(isCompany ? day.company : day.shop, id, qty)
    }
    if (isCompany) {
      day.companyOrders.push(order)
      day.companySets += order.sets ?? 0
    } else {
      day.shopOrders.push(order)
    }
  }
  return days
}

// Các tuần của tháng chứa `month` (bắt đầu Thứ Hai); ô ngoài tháng là null
export function monthWeeks(month: string): (string | null)[][] {
  const first = monthStart(month)
  const last = monthEnd(month)
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export const sumQty = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0)
