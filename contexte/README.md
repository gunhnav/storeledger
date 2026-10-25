# Thư mục contexte/ — Bộ nhớ tri thức dự án

Thư mục này lưu trữ những kiến thức, quyết định kiến trúc, quy tắc nghiệp vụ và bài học thực tế mà AI cùng nhóm phát triển đã đúc rút được trong quá trình xây dựng dự án **web-nhap-lieu**.

---

## Mục lục tài liệu

| File | Nội dung chính |
|---|---|
| [`architecture.md`](architecture.md) | Kiến trúc tổng thể, mô hình dữ liệu Supabase, phân quyền RLS và bảo mật. |
| [`storefront-ordering.md`](storefront-ordering.md) | Cơ chế đặt hàng theo set, tính giá tự động, mã thanh toán QR Napas EMVCo và tích hợp Hangout/Zalo. |
| [`rules-of-hooks-incident.md`](rules-of-hooks-incident.md) | Bài học phân tích sự cố vi phạm React Rules of Hooks sau return sớm và quy chuẩn phòng ngừa. |

---

## Quy tắc ghi nhận tri thức

1. **Mỗi chủ đề một file**: Khi học được một nguyên lý, quy ước hoặc giải pháp phức tạp mới có giá trị lâu dài, hãy tạo file markdown mới trong thư mục này.
2. **Cập nhật MAP.md**: Luôn khai báo tài liệu mới tạo vào [`MAP.md`](../MAP.md).
3. **Độ súc tích & Minh bạch**: Ghi rõ bối cảnh, lý do đưa ra quyết định, và các ràng buộc kỹ thuật đi kèm.
