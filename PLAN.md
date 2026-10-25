# PLAN.md — Kế hoạch phát triển & Tiến độ (Roadmap)

Tài liệu theo dõi lộ trình phát triển, các hạng mục đã hoàn thành và danh sách công việc ưu tiên tiếp theo.

---

## 🚀 Trạng thái hiện tại: Ổn định & Đồng bộ thương hiệu

### ✅ Các hạng mục vừa hoàn thành gần nhất
1. **Khôi phục an toàn 3 trang báo cáo**: Sửa triệt để lỗi Rules of Hooks sau return sớm tại `RevenueReport.tsx`, `ExpenseReport.tsx`, `ItemSalesPage.tsx`.
2. **Nâng cấp Storefront Kênh Công ty**:
   - Nhận đơn giao theo `domain` nội bộ và `tầng` làm việc.
   - Nội dung chuyển khoản tự động chuẩn hoá `domain - F tầng`.
   - Nút gửi đơn Hangout (Google Chat) mở trực tiếp và copy sẵn email người nhận.
   - Hỗ trợ tải mã QR thanh toán động và hoá đơn PNG.
3. **Món bán lẻ Sữa chua Hy Lạp & Nước whey**:
   - Phân loại món lẻ `single` không bắt buộc chọn set 4 hoặc 6 hũ.
   - Giỏ hàng linh hoạt trộn lẫn cả dòng set và dòng món lẻ.
4. **Đồng bộ thiết kế nghệ thuật SVG**:
   - Tạo mới bộ 3 hình minh hoạ vector SVG: Sữa chua Hy Lạp 110g, Sữa chua Hy Lạp 400g, Nước whey 220ml.
   - Loại bỏ hoàn toàn emoji hệ thống lạc điệu, đạt 100% tính thẩm mỹ thương hiệu.
5. **Thiết lập bộ khung Harness 3 tầng**:
   - Khởi tạo đầy đủ `CLAUDE.md`, `MAP.md`, `AGENTS.md`, `SPEC.md`, `PLAN.md`, `WORKTREE.md`.
   - Tổ chức các thư mục `contexte/`, `sources/`, `livrables/`, `docs/`, `.claude/`.

---

## 📋 Danh sách công việc tiếp theo (Backlog ưu tiên)

### Ưu tiên cao (High Priority)
- [ ] **Tối ưu hiển thị giỏ hàng trên màn hình di động nhỏ**: Kiểm tra độ cao thanh chọn set floating khi mở bàn phím ảo trên iOS/Android.
- [ ] **Lưu nháp thông tin khách hàng**: Tự động ghi nhớ `name`, `domain`, `floor` vào `localStorage` của trình duyệt để khách không phải gõ lại mỗi lần đặt món.
- [ ] **Tùy biến bảng giá set linh hoạt trong admin**: Bổ sung giao diện chỉnh sửa bảng giá set cho từng cửa hàng ngay trong màn hình Cài đặt cửa hàng.

### Ưu tiên trung bình (Medium Priority)
- [ ] **Lịch sử đơn đặt trước cho Admin**: Bổ sung tab xem danh sách đơn khách đã gửi và đánh dấu trạng thái "Đã nhận đơn", "Đang giao", "Đã thanh toán".
- [ ] **Thông báo âm thanh khi có đơn mới**: Chuông thông báo nhẹ trên máy tính của quán khi khách gửi đơn.
- [ ] **Tối ưu bundle kích thước vendor**: Áp dụng phân tách chunk cho thư viện Recharts để giảm kích thước bundle ban đầu.

### Ưu tiên dài hạn (Long-term)
- [ ] **Chương trình tích điểm khách hàng thân thiết**: Tích điểm theo số hũ đã mua qua domain công ty.
- [ ] **PWA (Progressive Web App)**: Cung cấp trải nghiệm cài đặt ứng dụng web trực tiếp vào màn hình chính điện thoại của nhân viên và khách hàng.
