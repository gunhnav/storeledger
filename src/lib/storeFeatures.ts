// Khác biệt quy trình theo cửa hàng (theo mã quán).
// Bún đậu bán ngay tại chỗ: không có bước Phân phối, hàng nhập xong vào thẳng tồn quán.
const NO_DISTRIBUTION = new Set(['bundau'])

export function usesDistribution(storeCode: string | undefined): boolean {
  return !(storeCode && NO_DISTRIBUTION.has(storeCode))
}
