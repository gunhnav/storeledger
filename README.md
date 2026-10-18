# Sổ Xanh

Sổ nhập liệu bán hàng cho cửa hàng nhỏ: nhập hàng → chuyển ra quầy → bán, kèm báo cáo lãi lỗ, thống kê theo đợt nhập (FIFO) và hoà vốn. Giao diện 5 ngôn ngữ (vi/en/ko/zh/ja), sáng/tối.

- Frontend: Vite + React 19 + TypeScript, react-router, react-hook-form, recharts
- Backend: Supabase (Postgres + RLS, hàm SECURITY DEFINER, Edge Function `admin-users`)

## Chạy ở máy

Cần Node ≥ 20.19 và yarn.

```bash
cp .env.example .env.local   # điền VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY
yarn install
yarn dev
```

Kiểm tra trước khi commit: `yarn build`, `yarn lint`, `yarn test`, `yarn i18n:check`.

## Deploy

### 1. Supabase

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push --linked          # áp dụng supabase/migrations
npx supabase functions deploy admin-users
```

- Tài khoản admin đầu tiên: tạo user trong Supabase Dashboard → Authentication, rồi đặt `role = 'admin'` trong bảng `public.profiles`. Các nhân viên sau đó admin tạo ở trang Nhân viên.
- Authentication → URL Configuration: đặt **Site URL** là tên miền đã deploy.

### 2. Frontend (trang tĩnh)

- Lệnh build: `yarn build`, thư mục xuất: `dist`
- Biến môi trường: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (anon key vốn công khai; **không** dùng secret / service_role key ở frontend)
- App dùng đường dẫn kiểu SPA nên mọi đường dẫn phải trả về `index.html`. Đã có sẵn `vercel.json` (Vercel) và `public/_redirects` (Netlify, Cloudflare Pages).

### 3. Giữ Supabase không bị tạm dừng (gói miễn phí)

Workflow `.github/workflows/keep-supabase-alive.yml` gọi API 2 ngày một lần. Cần đặt GitHub Secrets `SUPABASE_URL` và `SUPABASE_ANON_KEY`.
