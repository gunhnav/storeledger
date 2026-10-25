# Kiến trúc hệ thống & Mô hình bảo mật

Tài liệu mô tả kiến trúc tổng thể của hệ thống **web-nhap-lieu** (Sổ Xanh / Hogi Food / Bún đậu Em Thúy).

---

## 1. Mô hình tổng thể (Frontend + Supabase BaaS)

```text
[Trình duyệt Khách hàng]             [Trình duyệt Quản trị viên / Nhân viên]
  (/hogi, /shop/<mã>)                  (/, /revenue, /expenses, /inventory...)
         │                                               │
         ▼                                               ▼
   React 19 SPA (Vite, TypeScript, React Router, Canvas API, Recharts)
         │                                               │
         └───────────────────────┬───────────────────────┘
                                 │
                     HTTPS / Supabase Client SDK
                                 │
                                 ▼
                     [Supabase Cloud Platform]
            ┌─────────────────────────────────────────┐
            │ - Postgres Database 15+                 │
            │ - Row Level Security (RLS)              │
            │ - Stored Procedures (SECURITY DEFINER) │
            │ - Supabase Auth (JWT & Roles)           │
            │ - Edge Functions (Deno Runtime)         │
            └─────────────────────────────────────────┘
```

---

## 2. Mô hình bảo mật & Row Level Security (RLS)

- Mọi bảng dữ liệu nghiệp vụ (`stores`, `products`, `orders`, `invoices`, `inventory_batches`, `expenses`) đều kích hoạt **Row Level Security (RLS)**.
- **Phân tách dữ liệu theo Tenant/Store**: Mỗi tài khoản nhân viên được liên kết với một `store_id`. Policy đảm bảo user chỉ đọc và ghi dữ liệu thuộc cửa hàng của mình.
- **Trang Storefront công khai (`/shop/<mã>`)**:
  - Khách truy cập ẩn danh không cần đăng nhập.
  - Sử dụng hàm SQL Security Definer hoặc query bảng `stores`, `products` có policy cho phép `anon` đọc thông tin công khai (tên quán, menu, bảng giá set, tài khoản nhận tiền).
  - Khách không thể đọc doanh thu, chi phí, kho hay thông tin khách hàng khác.

---

## 3. Quản lý bí mật & Bảo mật khi Public Repo

Khi mã nguồn được công khai (Public Repository), kiến trúc bảo mật tuân thủ nghiêm ngặt mô hình Zero-Trust:

1. **Frontend không chứa Secret**:
   - `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` là thông tin công khai dành cho trình duyệt.
   - `SUPABASE_SERVICE_ROLE_KEY` tuyệt đối không được đưa vào frontend hay Git.
2. **Supabase Vault (`supabase_vault`)**:
   - Lưu trữ các thông tin bí mật (API key, webhook secrets, payment tokens) dưới dạng mã hoá (pgsodium / TDE) trong schema `vault`.
   - Các bảng trong `vault` bị thu hồi quyền truy cập từ `anon` và `authenticated`. Chỉ hàm `SECURITY DEFINER` nội bộ có kiểm tra quyền admin mới được đọc thông qua view `vault.decrypted_secrets`.
3. **Supabase Edge Functions Secrets**:
   - Các biến nhạy cảm như `GEMINI_API_KEY` được lưu trữ trên hạ tầng bảo mật của Supabase qua lệnh `supabase secrets set`.
   - Mã nguồn trong Git chỉ gọi `Deno.env.get(...)`, không lưu giá trị key.
4. **JWT Secret & Supabase Auth**:
   - JWT Secret nằm trên máy chủ Supabase, dùng để ký chữ ký điện tử cho mọi phiên đăng nhập của người dùng.
   - Database xác thực tính hợp lệ của token qua chữ ký này trước khi áp dụng RLS (Row Level Security).
   - 100% các bảng (25/25 bảng) đều bật RLS, ngăn chặn triệt để mọi truy cập trái phép.

---

## 4. Quản lý trạng thái & Xử lý bất đồng bộ

- Sử dụng React 19 với state quản lý tại từng module, không lạm dụng state toàn cục nặng nề.
- Toàn bộ hook side-effect (`useEffect`, `useCallback`, `useMemo`) đều tuân thủ nghiêm ngặt **React Rules of Hooks**:
  - Không gọi hook sau bất kỳ lệnh `return` điều kiện nào.
  - Đặt dependency array chính xác, tránh re-render thừa.
