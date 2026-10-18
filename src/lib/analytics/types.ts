// Dữ liệu thô đã chuẩn hoá cho phần phân tích (giống các bảng trong file Excel).
// Ngày dạng 'YYYY-MM-DD'. Tiền là số đồng, không làm tròn giữa chừng.

export type AProduct = {
  id: string
  name: string
  // Ngưỡng "sắp hết" (số hũ)
  threshold: number
  // Chỉ món đếm tồn mới có đợt nhập / tồn kho
  tracksStock: boolean
}

// Một dòng của đợt nhập: một loại trong một đợt
export type ABatchLine = {
  id: string
  purchaseId: string
  date: string
  productId: string
  qty: number
  unitCost: number
}

export type APurchase = {
  id: string
  date: string
  note: string | null
}

// Một dòng bán: số hũ một loại trong một đơn, giá đã chụp lúc bán
export type ASaleLine = {
  date: string
  productId: string
  qty: number
  unitPrice: number
  // Hoa hồng ShopeeFood (0 nếu bán tại quầy)
  commissionRate: number
  // Giá vốn đã chụp lúc bán (tổng các dòng giá vốn); dùng cho món không đếm tồn
  cost?: number
  // Kênh bán; 'company' trừ hàng đã phân phối cho công ty thay vì tồn quán
  channel?: string
}

export type ATransfer = {
  date: string
  productId: string
  qty: number
  // Nơi nhận: quán (mặc định) hoặc công ty
  destination?: 'shop' | 'company'
}

export type AExpense = {
  date: string
  amount: number
}

// Lịch sử giá bán: giá có hiệu lực vào ngày D = dòng có effectiveFrom ≤ D lớn nhất
export type APriceRow = {
  productId: string
  effectiveFrom: string
  salePrice: number
}

export type AnalyticsInput = {
  products: AProduct[]
  purchases: APurchase[]
  batchLines: ABatchLine[]
  sales: ASaleLine[]
  transfers: ATransfer[]
  expenses: AExpense[]
  prices: APriceRow[]
}
