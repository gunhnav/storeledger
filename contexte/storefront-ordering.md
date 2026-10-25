# Nghiệp vụ Đặt hàng Storefront (Kênh Công ty & Khách lẻ)

Tài liệu mô tả chi tiết logic đặt trước theo set, tính giá, mã QR động và gửi đơn của trang khách (`/hogi`, `/shop/<mã quán>`).

---

## 1. Cơ chế tính giá Set & Món lẻ

Triển khai tại [`src/lib/storefront.ts`](../src/lib/storefront.ts).

### A. Đặt theo Set 4 hoặc 6 hũ (`mode: 'set'`)
1. **Set chỉ có 1 vị**: Nếu cửa hàng có cấu hình giá riêng cho vị đó (ví dụ: Set 4 hũ toàn Truyền thống giá 50.000đ), hệ thống ưu tiên áp dụng giá này.
2. **Set mix nhiều vị**: Nếu dòng món có từ 2 vị trở lên và quán có đặt giá mặc định cho cỡ set (ví dụ: Set 4 hũ mix vị giá 55.000đ), áp dụng giá mix.
3. **Giá cộng dồn**: Nếu không khớp 2 trường hợp trên, giá set bằng tổng giá lẻ từng hũ.
4. **Quy tắc dòng món (Category)**: Các vị khác dòng (ví dụ: Sữa chua thường vs Bánh flan) không được trộn chung vào một set.

### B. Món bán lẻ (`mode: 'single'`)
- Áp dụng cho các sản phẩm không bán theo set: Sữa chua Hy Lạp (hũ nhỏ 110g, hũ lớn 400g), Nước whey chai 220ml.
- Bấm `+` / `-` trực tiếp để tăng/giảm số lượng vào giỏ hàng.
- Giỏ hàng có thể chứa đồng thời cả dòng set và dòng món lẻ.

---

## 2. Thông tin giao nhận & Chuyển khoản nội bộ

- **Domain nội bộ**: Chữ không dấu, số, dấu chấm (ví dụ: `huong.vu3`). Tự động làm sạch đuôi email nếu khách lỡ nhập `@...`.
- **Tầng giao hàng**: Số hoặc chữ cái viết hoa (ví dụ: `6`, `F6`, `B1`).
- **Nội dung chuyển khoản chuẩn**: Tự động ghép thành cú pháp:
  ```text
  <domain> - F<tầng>    # Ví dụ: huong.vu3 - F6
  ```

---

## 3. Mã QR Napas EMVCo & Tạo hoá đơn ảnh

1. **Chuỗi QR EMVCo Napas**:
   - Triển khai tại [`src/lib/emvQr.ts`](../src/lib/emvQr.ts).
   - Ghép mã ngân hàng, số tài khoản, số tiền và nội dung chuyển khoản động vào payload chuẩn EMVCo Tag 00-62.
   - Cho phép khách mở ứng dụng ngân hàng hoặc MoMo quét trực tiếp không cần nhập tay số tiền hay nội dung.
2. **Kết xuất ảnh hoá đơn PNG**:
   - Triển khai tại [`src/lib/invoiceImage.ts`](../src/lib/invoiceImage.ts).
   - Vẽ trực tiếp trên HTML5 Canvas: logo, mã đơn, danh sách chi tiết các món, tổng tiền, thông tin người đặt và ghi chú thanh toán.
   - Cho phép khách tải về máy làm ảnh biên lai hoặc gửi qua chat.

---

## 4. Kênh gửi đơn (Hangout vs Zalo)

- **Nếu quán có cấu hình domain công ty**:
  - Tự động hiển thị nút: **"Gửi đơn qua Hangout"**.
  - Nhấp nút: Sao chép sẵn toàn bộ nội dung đơn đặt hàng vào clipboard, đồng thời mở tab Google Chat (`https://chat.google.com/`).
  - Hướng dẫn khách dán email `${domain}@${COMPANY_MAIL_DOMAIN}` vào ô tìm người và gửi đơn.
- **Nếu quán cấu hình số điện thoại**:
  - Hiển thị nút: **"Gửi đơn qua Zalo"** mở link `zalo.me/<phone>` với nội dung đơn được sao chép sẵn.
