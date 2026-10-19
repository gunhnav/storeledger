// Khác biệt quy trình theo cửa hàng (theo mã quán).
// Bún đậu bán ngay tại chỗ: không có bước Phân phối, hàng nhập xong vào thẳng tồn quán.
const NO_DISTRIBUTION = new Set(['bundau'])

// Kênh bán cho phép chọn khi tạo đơn. Hogi đã bỏ ShopeeFood (đơn cũ kênh shopeefood vẫn giữ trong DB và báo cáo);
// Bún đậu giữ ShopeeFood.
export type SelectableChannel = 'in_store' | 'shopeefood' | 'company'
const HAS_SHOPEEFOOD = new Set(['bundau'])

export function salesChannels(storeCode: string | undefined): SelectableChannel[] {
  return storeCode && HAS_SHOPEEFOOD.has(storeCode) ? ['in_store', 'shopeefood', 'company'] : ['in_store', 'company']
}

export function usesDistribution(storeCode: string | undefined): boolean {
  return !(storeCode && NO_DISTRIBUTION.has(storeCode))
}
