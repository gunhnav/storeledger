import { evalExpression } from './calc'

// Nhóm chi phí cố định theo cửa hàng (DB nhận hợp của các danh sách, xem
// 20261018162323_company_channel_expense_groups.sql). Quán không có danh sách riêng dùng nhóm mặc định.
export const EXPENSE_GROUPS = ['Dụng cụ', 'Bao bì', 'In ấn - quảng cáo', 'Vận chuyển', 'Khác'] as const
const STORE_EXPENSE_GROUPS: Record<string, readonly string[]> = {
  bundau: ['Đồ uống', 'Nguyên liệu', 'Dụng cụ', 'Quảng cáo', 'Khác'],
}

export function expenseGroupsFor(storeCode: string | undefined): readonly string[] {
  return (storeCode && STORE_EXPENSE_GROUPS[storeCode]) || EXPENSE_GROUPS
}

export type ExpenseLine = {
  // Thành tiền (lưu vào amount, giữ số gốc khi ghi đè)
  total: number
  // Đơn giá hiển thị / lưu: khi ghi đè = thành tiền ÷ số lượng
  unitPrice: number
  overridden: boolean
}

// Thành tiền mặc định = số lượng × đơn giá; nếu ghi đè thành tiền thì đơn giá = thành tiền ÷ số lượng
export function expenseLine(quantity: number, unitPrice: number, overrideTotal: number | null = null): ExpenseLine {
  if (overrideTotal !== null) {
    return { total: overrideTotal, unitPrice: quantity > 0 ? overrideTotal / quantity : 0, overridden: true }
  }
  return { total: quantity * unitPrice, unitPrice, overridden: false }
}

// Đơn giá lưu DB (numeric 2 chữ số); thành tiền không làm tròn
export function storedUnitPrice(unitPrice: number): number {
  return Math.round(unitPrice * 100) / 100
}

// Một dòng trong form nhập nhiều chi phí (chuỗi để cho phép ô trống khi đang gõ)
export type ExpenseDraft = { category: string; note: string; quantity: string; unitPrice: string; total: string }

export const isBlankDraft = (d: ExpenseDraft) =>
  d.note.trim() === '' && d.unitPrice.trim() === '' && d.total.trim() === '' && (d.quantity.trim() === '' || d.quantity.trim() === '1')

// Ô tiền cho phép phép tính (50000+30000*2, 3x25k…); ô trống hoặc phép tính sai là NaN
const num = (text: string) => (text.trim() === '' ? Number.NaN : (evalExpression(text) ?? Number.NaN))

// Kiểm tra một dòng và tính số lưu DB; dòng trống hoàn toàn bỏ qua ở nơi gọi
export function parseDraft(
  d: ExpenseDraft,
  maxMoney: number,
): { ok: true; quantity: number; unitPrice: number; total: number } | { ok: false; error: string } {
  const quantity = num(d.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) return { ok: false, error: 'Số lượng phải lớn hơn 0' }
  if (d.total.trim() !== '' && evalExpression(d.total) === null) return { ok: false, error: 'Phép tính ở ô Thành tiền không hợp lệ' }
  if (d.unitPrice.trim() !== '' && evalExpression(d.unitPrice) === null) return { ok: false, error: 'Phép tính ở ô Đơn giá không hợp lệ' }
  const override = d.total.trim() === '' ? null : num(d.total)
  const unit = num(d.unitPrice)
  if (override === null && (!Number.isFinite(unit) || unit < 0)) return { ok: false, error: 'Nhập đơn giá hoặc thành tiền' }
  const line = expenseLine(quantity, Number.isFinite(unit) ? unit : 0, override)
  if (!Number.isFinite(line.total) || line.total <= 0) return { ok: false, error: 'Số tiền phải lớn hơn 0' }
  if (line.total > maxMoney) return { ok: false, error: 'Số tiền quá lớn, kiểm tra lại' }
  return { ok: true, quantity, unitPrice: storedUnitPrice(line.unitPrice), total: line.total }
}
