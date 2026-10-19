// Khác biệt quy trình theo cửa hàng (theo mã quán).
// Bún đậu bán ngay tại chỗ: không có bước Phân phối, hàng nhập xong vào thẳng tồn quán.
const NO_DISTRIBUTION = new Set(['bundau'])

// Kênh bán cho phép chọn khi tạo đơn (ShopeeFood đã bỏ; đơn cũ kênh shopeefood vẫn giữ trong DB và báo cáo)
export type SelectableChannel = 'in_store' | 'company'
export function salesChannels(storeCode: string | undefined): SelectableChannel[] {
  void storeCode // hiện cả hai quán dùng chung; tách theo quán tại đây khi cần
  return ['in_store', 'company']
}

export function usesDistribution(storeCode: string | undefined): boolean {
  return !(storeCode && NO_DISTRIBUTION.has(storeCode))
}
