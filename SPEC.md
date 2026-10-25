# SPEC.md — Đặc tả kỹ thuật & Nghiệp vụ ứng dụng

---

## 1. Tổng quan ứng dụng

`web-nhap-lieu` là ứng dụng web quản lý sổ sách bán hàng, nhập kho, tính lãi lỗ và nhận đơn đặt trước trực tuyến dành cho các cửa hàng nhỏ / hộ kinh doanh ẩm thực. Ứng dụng hỗ trợ hai mô hình kinh doanh điển hình:
1. **Hogi Food**: Cửa hàng sữa chua hũ handmade, sữa chua Hy Lạp (tách nước whey) và bánh flan caramel.
2. **Bún đậu Em Thúy**: Quán ẩm thực truyền thống bún đậu mắm tôm.

Ứng dụng chia làm hai phân hệ chính:
- **Phân hệ Quản trị (Admin / Sổ nội bộ)**: Nhập hàng, xuất kho quầy, kiểm kê, chấm công, ghi chép doanh thu & chi phí, báo cáo lãi lỗ theo phương pháp nhập trước xuất trước (FIFO) và phân tích điểm hoà vốn.
- **Phân hệ Trang khách (Storefront công khai)**: Truy cập qua `/hogi` hoặc `/shop/<store-code>` giúp khách hàng công ty hoặc khách lẻ đặt trước món, tự phối set hũ theo sở thích, xem bảng giá minh bạch, nhận mã QR thanh toán động và gửi đơn trực tiếp qua Hangout / Zalo.

---

## 2. Kiến trúc kỹ thuật

### Frontend
- **Framework**: React 19, Vite 8, TypeScript 5.
- **Định tuyến (Routing)**: React Router 7.
- **Biểu đồ & Thống kê**: Recharts.
- **Biểu tượng**: Lucide React.
- **Đa ngôn ngữ**: Hệ thống quản lý i18n hỗ trợ 5 ngôn ngữ (`vi`, `en`, `ko`, `zh`, `ja`).
- **Xử lý đồ hoạ & Hoá đơn**: Canvas API kết xuất ảnh hoá đơn định dạng PNG (`src/lib/invoiceImage.ts`).
- **Thanh toán QR**: Tạo chuỗi dữ liệu EMVCo QR chuẩn Napas kết hợp mã hoá đơn và thông tin tài khoản ngân hàng (`src/lib/emvQr.ts`).

### Backend & Cơ sở dữ liệu
- **Nền tảng**: Supabase BaaS (Postgres Database, Supabase Auth, Storage, Edge Functions).
- **Phân quyền bảo mật**: Row Level Security (RLS) bảo vệ từng tenant/cửa hàng.
- **Stored Procedures**: Các hàm SQL `SECURITY DEFINER` thực thi tác vụ quản trị an toàn.
- **Edge Functions**:
  - `admin-users`: Tạo và phân quyền tài khoản nhân viên.
  - `chat-assistant`: Trợ lý AI hỏi đáp dữ liệu bán hàng.

---

## 3. Đặc tả phân hệ Storefront (Trang đặt hàng)

### A. Cơ chế dòng món & Chọn set
- **Chế độ theo set (`mode: 'set'`)**: Áp dụng cho dòng sữa chua truyền thống và các vị (matcha, phô mai, ca cao, nếp cẩm) hoặc bánh flan. Khách chọn set 4 hoặc set 6 hũ.
  - Set chỉ gồm 1 vị: Dùng giá cấu hình riêng của vị đó (nếu quán đã cài đặt).
  - Set mix nhiều vị: Dùng giá mặc định cho set mix của cỡ set đó.
  - Trường hợp khác: Tự động tính tổng giá lẻ từng hũ.
- **Chế độ bán lẻ (`mode: 'single'`)**: Áp dụng cho các món không bán theo set, ví dụ: Sữa chua Hy Lạp hũ làm quen 110g, hũ tri kỷ 400g, nước whey chai 220ml. Khách bấm `+` / `-` thêm trực tiếp vào giỏ.

### B. Thông tin giao hàng & Thanh toán
- **Khách nội bộ công ty**: Giao theo `domain` (tài khoản công ty, vd: `huong.vu3`) và `tầng` (vd: `6` hoặc `F6`).
- **Nội dung chuyển khoản tự động**: Chuẩn hoá dạng `domain - F tầng` (vd: `huong.vu3 - F6`).
- **Kênh gửi đơn**:
  - Nếu quán có cấu hình domain công ty: Ưu tiên gửi đơn qua Google Chat (Hangout), tự sao chép email `${domain}@${COMPANY_MAIL_DOMAIN}` và mở `chat.google.com`.
  - Nếu chỉ có số điện thoại: Gửi đơn qua Zalo link `zalo.me/<phone>`.
- **Thanh toán QR**:
  - Mã QR VietQR động tích hợp sẵn số tiền, nội dung chuyển khoản và chủ tài khoản.
  - Hỗ trợ tải mã QR về máy để quét từ ứng dụng ngân hàng / ví MoMo.
  - Hỗ trợ tải hoá đơn đơn hàng định dạng ảnh PNG sắc nét.

---

## 4. Tiêu chí chất lượng & Kiểm thử

1. **Type Safety**: Toàn bộ codebase TypeScript ở chế độ strict, không dùng `any` bừa bãi.
2. **Linting**: 0 lỗi linter từ `oxlint`, tuân thủ 100% React Rules of Hooks.
3. **Unit Tests**: Duy trì và mở rộng bộ kiểm thử Vitest với 187+ test cases bao phủ logic tính giá, giỏ hàng, QR, chuyển khoản và phân tích doanh thu.
4. **i18n Coverage**: Quét tự động bằng `scripts/check-i18n.mjs`, cam kết 0 khoá bị thiếu trên cả 5 ngôn ngữ.
5. **Hiệu năng & Bundle**: Tách code splitting hợp lý (`React.lazy`), CSS tối ưu không lag khi gõ form hoặc cuộn danh sách món.
