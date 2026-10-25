# CLAUDE.md — Quy tắc làm việc & Bản đồ điều hành (Harness)

Tài liệu cốt lõi cho Claude Code và các AI coding assistant khi làm việc trên dự án **web-nhap-lieu** (Sổ Xanh / Hogi Food / Bún đậu Em Thúy).
> **QUY TẮC SỐ 1**: Đọc `CLAUDE.md` và `MAP.md` ở đầu mỗi phiên hội thoại trước khi thực hiện bất kỳ hành động nào. Mỗi khi tạo hoặc di chuyển file, **PHẢI** cập nhật mô tả vào `MAP.md`.

---

## 1. Thông tin dự án

- **Tên dự án**: `web-nhap-lieu` (Sổ Xanh / Hogi Food / Bún đậu Em Thúy).
- **Mục tiêu**: Hệ thống sổ nhập liệu, quản lý bán hàng theo đợt nhập (FIFO), quản lý chi phí, báo cáo doanh thu & lãi lỗ; kèm cổng đặt hàng công khai theo set hoặc bán lẻ (`/hogi`, `/shop/<mã quán>`) tích hợp QR động Napas EMVCo, tạo hoá đơn ảnh PNG, gửi đơn qua Google Chat (Hangout) và Zalo.
- **Ngôn ngữ & Nền tảng**:
  - **Frontend**: React 19, TypeScript (strict mode), Vite 8, React Router 7, Recharts, Lucide React, Canvas API.
  - **Backend**: Supabase (Postgres 15+, Row Level Security, RPC Security Definer, Edge Functions).
  - **Quản lý gói**: Yarn v1 (`yarn.lock`).
  - **Đa ngôn ngữ**: 5 ngôn ngữ (`vi`, `en`, `ko`, `zh`, `ja`) qua hệ thống kiểm tra khoá tự động `scripts/check-i18n.mjs`.

---

## 2. Lệnh vận hành & Kiểm tra (Bắt buộc chạy sạch trước khi commit)

Mọi thay đổi code **BẮT BUỘC** phải vượt qua bộ kiểm tra 5 bước sau không có bất kỳ lỗi nào:

```bash
yarn tsc -b         # Kiểm tra type TypeScript
yarn lint           # Kiểm tra linter oxlint (0 error, bao gồm react/rules-of-hooks)
yarn test           # Chạy toàn bộ 187+ unit test với vitest
yarn i18n:check     # Kiểm tra độ đồng bộ 5 ngôn ngữ (thiếu tổng cộng phải bằng 0)
yarn build          # Build production bằng Vite
```

### Các lệnh phát triển khác:
```bash
yarn dev            # Chạy dev server tại localhost:5173
yarn preview        # Xem thử bản build production
```

### Công cụ tối ưu token RTK (Rust Token Killer):
```bash
rtk gain            # Xem thống kê token tiết kiệm
rtk proxy <cmd>     # Chạy raw command khi cần debug
```

---

## 3. Kỷ luật lập trình & Quy tắc an toàn sống còn

### A. Quy tắc React Hooks (Bất khả xâm phạm)
- **TUYỆT ĐỐI KHÔNG** gọi bất kỳ Hook nào (`useMemo`, `useState`, `useEffect`, `useCallback`...) sau bất kỳ lệnh `return` sớm nào hoặc bên trong câu lệnh điều kiện (`if`, vòng lặp).
- Mọi Hook **PHẢI** đặt ở phần đầu của component body.
- *Bài học xương máu*: Xem [`contexte/rules-of-hooks-incident.md`](contexte/rules-of-hooks-incident.md).

### B. Bảo mật & Biến môi trường
- Chỉ lưu secrets trong `.env.local` (đã nằm trong `.gitignore`). Tuyệt đối không commit key hay token.
- Sử dụng file mẫu `.env.example` để chia sẻ danh sách biến môi trường cần thiết.
- Không dùng service_role key ở frontend; mọi truy cập DB từ client đi qua Supabase anon key + RLS policies.

### C. Quy tắc Database & Migration
- Không bao giờ tự ý chạy lệnh phá huỷ hoặc thay đổi database trực tiếp mà không có sự đồng ý của người dùng.
- Mọi thay đổi schema database phải qua file migration tuần tự trong `supabase/migrations/` tuân thủ nguyên tắc idempotency.

### D. Quy tắc Git & Worktree
- Không commit file cấu hình cục bộ cá nhân (`.agents/`, `.claude/settings.local.json`, `skills-lock.json`).
- Không đổi git config, remote, không đụng `~/.ssh` hay `~/.gitconfig`, tuyệt đối **KHÔNG** dùng `--force`.
- Khi cần chạy nhiều task song song, tuân thủ hướng dẫn tại [`WORKTREE.md`](WORKTREE.md).

---

## 4. Định hướng tài liệu bộ nhớ (3-Level Harness)

- **Bản đồ dự án**: Tra cứu cấu trúc thư mục tại [`MAP.md`](MAP.md).
- **Quy tắc Agent**: Xem [`AGENTS.md`](AGENTS.md).
- **Yêu cầu & Phạm vi**: Xem [`SPEC.md`](SPEC.md).
- **Kế hoạch & Tiến độ**: Xem [`PLAN.md`](PLAN.md).
- **Bộ nhớ AI dài hạn**: Ghi nhận bài học, quyết định kiến trúc vào [`contexte/`](contexte/).
- **Sản phẩm bàn giao**: Xuất file kết quả vào [`livrables/`](livrables/).
- **Tài liệu thô**: Đặt tài liệu tham khảo đầu vào tại [`sources/`](sources/).
