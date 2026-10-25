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

// Bước tiếp theo hay dùng cho mỗi trạng thái (nút bấm nhanh)
export const NEXT_STATUS: Partial<Record<PreorderStatus, PreorderStatus>> = { new: 'confirmed', confirmed: 'paid', paid: 'delivered' }

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

// Câu thông báo khi có đơn mới
export const preorderAlert = (p: Pick<Preorder, 'code' | 'customer_domain' | 'floor' | 'total'>) =>
  `Đơn đặt trước mới ${p.code}: ${p.customer_domain} (tầng ${p.floor}) · ${vnd(Number(p.total))}`

// Đếm theo trạng thái và tổng tiền các đơn chưa giao, chưa huỷ (để quán chuẩn bị hàng)
export function summarizePreorders(rows: Pick<Preorder, 'status' | 'total'>[]) {
  const counts = Object.fromEntries(PREORDER_STATUSES.map((s) => [s, 0])) as Record<PreorderStatus, number>
  let openTotal = 0
  for (const r of rows) {
    counts[r.status] += 1
    if (r.status !== 'delivered' && r.status !== 'cancelled') openTotal += Number(r.total)
  }
  return { counts, openTotal }
}

// Cộng số hũ / món cần chuẩn bị của các đơn chưa giao, theo tên món (set tính theo mô tả vị)
export function itemsToPrepare(rows: Pick<Preorder, 'status' | 'lines'>[]): { title: string; qty: number }[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.status === 'delivered' || r.status === 'cancelled') continue
    for (const l of r.lines) {
      const key = l.kind === 'set' ? `${l.title} (${l.detail})` : l.title
      map.set(key, (map.get(key) ?? 0) + l.qty)
    }
  }
  return [...map].map(([title, qty]) => ({ title, qty })).sort((a, b) => b.qty - a.qty)
}
