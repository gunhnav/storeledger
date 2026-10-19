// Khác biệt quy trình theo cửa hàng (theo mã quán).
// Bún đậu bán ngay tại chỗ: không có bước Phân phối, hàng nhập xong vào thẳng tồn quán.
const NO_DISTRIBUTION = new Set(['bundau'])

// Kênh bán cho phép chọn khi tạo đơn.
//  - Hogi: Quán, Công ty (đã bỏ ShopeeFood; đơn cũ kênh shopeefood vẫn giữ trong DB và báo cáo).
//  - Bún đậu: Quán, Đối tác. "Đối tác" dùng giá trị kênh 'shopeefood' trong DB (giá đối tác = app_price,
//    hoa hồng mặc định của cửa hàng), chỉ đổi tên hiển thị nên không cần migration.
export type SelectableChannel = 'in_store' | 'shopeefood' | 'company'
const PARTNER_STORES = new Set(['bundau'])

export const usesPartnerChannel = (storeCode: string | undefined) => !!storeCode && PARTNER_STORES.has(storeCode)

export function salesChannels(storeCode: string | undefined): SelectableChannel[] {
  return usesPartnerChannel(storeCode) ? ['in_store', 'shopeefood'] : ['in_store', 'company']
}

// Nhập kho dạng bảng như Chi phí (món, số lượng, đơn giá, thành tiền) và tự ghi vào Chi phí.
const EXPENSE_STYLE_PURCHASE = new Set(['bundau'])
export const usesExpenseStylePurchase = (storeCode: string | undefined) =>
  !!storeCode && EXPENSE_STYLE_PURCHASE.has(storeCode)

export function usesDistribution(storeCode: string | undefined): boolean {
  return !(storeCode && NO_DISTRIBUTION.has(storeCode))
}
