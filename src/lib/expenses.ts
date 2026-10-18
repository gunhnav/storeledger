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
