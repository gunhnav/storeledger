// Đơn đặt trước (từ trang khách) phía app quản trị: trạng thái, tóm tắt, thông báo đơn mới.
// Đơn đặt trước nằm ở bảng riêng `preorders`, KHÔNG tính vào bán hàng / kho / báo cáo của app.
import type { Preorder, PreorderStatus } from '../types/database'

export const PREORDER_STATUSES: PreorderStatus[] = ['new', 'confirmed', 'paid', 'delivered', 'cancelled']

export const STATUS_LABEL: Record<PreorderStatus, string> = {
  new: 'Mới',
  confirmed: 'Đã nhận đơn',
  paid: 'Đã thanh toán',
  delivered: 'Đã giao',
  cancelled: 'Đã huỷ',
}

// Bước tiếp theo (nút bấm nhanh) theo hình thức thanh toán:
// chuyển khoản: nhận đơn -> đã thanh toán (QR) -> đã giao; tiền mặt: nhận đơn -> đã giao -> thu tiền (đã thanh toán)
const TRANSFER_FLOW: Partial<Record<PreorderStatus, PreorderStatus>> = { new: 'confirmed', confirmed: 'paid', paid: 'delivered' }
const CASH_FLOW: Partial<Record<PreorderStatus, PreorderStatus>> = { new: 'confirmed', confirmed: 'delivered', delivered: 'paid' }

export const nextStatus = (o: Pick<Preorder, 'status' | 'payment'>): PreorderStatus | undefined =>
  (o.payment === 'transfer' ? TRANSFER_FLOW : CASH_FLOW)[o.status]

// Đơn đã xong: huỷ hoặc đi hết luồng (chuyển khoản kết thúc ở "đã giao", tiền mặt kết thúc ở "đã thanh toán")
export const isClosed = (o: Pick<Preorder, 'status' | 'payment'>) => o.status === 'cancelled' || !nextStatus(o)

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

// Câu thông báo khi có đơn mới
export const preorderAlert = (p: Pick<Preorder, 'code' | 'customer_domain' | 'floor' | 'total'>) =>
  `Đơn đặt trước mới ${p.code}: ${p.customer_domain} (tầng ${p.floor}) · ${vnd(Number(p.total))}`

// Đếm theo trạng thái và tổng tiền các đơn chưa giao, chưa huỷ (để quán chuẩn bị hàng)
export function summarizePreorders(rows: Pick<Preorder, 'status' | 'payment' | 'total'>[]) {
  const counts = Object.fromEntries(PREORDER_STATUSES.map((s) => [s, 0])) as Record<PreorderStatus, number>
  let openTotal = 0
  for (const r of rows) {
    counts[r.status] += 1
    if (!isClosed(r)) openTotal += Number(r.total)
  }
  return { counts, openTotal }
}

// Cộng số hũ / món cần chuẩn bị của các đơn chưa giao, theo tên món (set tính theo mô tả vị)
export function itemsToPrepare(rows: Pick<Preorder, 'status' | 'payment' | 'lines'>[]): { title: string; qty: number }[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.status === 'delivered' || r.status === 'cancelled' || (r.status === 'paid' && r.payment === 'cash')) continue
    for (const l of r.lines) {
      const key = l.kind === 'set' ? `${l.title} (${l.detail})` : l.title
      map.set(key, (map.get(key) ?? 0) + l.qty)
    }
  }
  return [...map].map(([title, qty]) => ({ title, qty })).sort((a, b) => b.qty - a.qty)
}
