// Giảm giá đơn bán: theo số tiền hoặc theo %. Tính giống hàm create_sale_discounted trong DB
// (số tiền giảm làm tròn về đồng) để số xem trước khớp số lưu.

export type DiscountType = 'amount' | 'percent'

export type DiscountInput = { type: DiscountType; value: string }

const parse = (value: string) => {
  const n = Number(value.replace(',', '.'))
  return value.trim() !== '' && Number.isFinite(n) ? n : 0
}

// Lỗi của ô giảm giá (khoá tiếng Việt để t()), null nếu hợp lệ hoặc để trống
export function discountError(subtotal: number, { type, value }: DiscountInput): string | null {
  if (value.trim() === '') return null
  const n = parse(value)
  if (!(n > 0)) return 'Mức giảm giá phải lớn hơn 0'
  if (type === 'percent' && n > 100) return 'Giảm giá theo phần trăm tối đa 100%'
  if (type === 'amount' && n > subtotal) return 'Giảm giá lớn hơn tiền hàng'
  return null
}

// Số tiền thực giảm (0 nếu ô trống hoặc không hợp lệ)
export function discountAmount(subtotal: number, input: DiscountInput): number {
  if (subtotal <= 0 || discountError(subtotal, input) !== null) return 0
  const n = parse(input.value)
  if (!(n > 0)) return 0
  const raw = input.type === 'percent' ? (subtotal * n) / 100 : n
  return Math.min(Math.round(raw), subtotal)
}
