# MAP.md — Bản đồ dự án (Project Atlas)

> **QUY TẮC BẮT BUỘC**: Mỗi khi tạo file mới hoặc di chuyển file, **PHẢI** thêm hoặc cập nhật một dòng mô tả tương ứng vào bản đồ này.

---

## 🗺️ Cây cấu trúc dự án tổng thể

```text
web-nhap-lieu/
├── CLAUDE.md                   # Bộ não điều hành: quy tắc làm việc, lệnh kiểm tra, kỷ luật code
├── CLAUDE.local.md             # Cấu hình sở thích cá nhân của dev (bị .gitignore)
├── MAP.md                      # Bản đồ dự án: tra cứu vị trí file và hướng dẫn lưu trữ
├── AGENTS.md                   # Quy tắc chung cho toàn bộ agent và subagent
├── SPEC.md                     # Đặc tả kỹ thuật & nghiệp vụ chi tiết của ứng dụng
├── PLAN.md                     # Kế hoạch phát triển, tiến độ và roadmap
├── WORKTREE.md                 # Quy tắc chạy đa nhiệm song song không conflict với Git Worktree
├── .worktreeinclude            # Danh sách file được tự động sao chép sang worktree mới
├── .mcp.json                   # Cấu hình công cụ MCP kết nối ngoài (Supabase MCP)
├── .env.example                # Mẫu cấu hình biến môi trường
├── .env.local                  # Biến môi trường cục bộ máy dev (chứa secrets, bị .gitignore)
├── .gitignore                  # Danh sách file & thư mục loại trừ khỏi git
├── README.md                   # Tài liệu giới thiệu dự án, cài đặt & deploy
├── package.json                # Định nghĩa thư viện phụ thuộc và npm scripts
├── yarn.lock                   # Khóa phiên bản gói cài đặt của Yarn
├── tsconfig.json               # Cấu hình TypeScript gốc
├── tsconfig.app.json           # Cấu hình TypeScript cho ứng dụng web (src/)
├── tsconfig.node.json          # Cấu hình TypeScript cho môi trường Node (vite/scripts)
├── vite.config.ts              # Cấu hình bundler Vite & plugin React
├── vercel.json                 # Cấu hình rewrite URL cho Vercel deploy
│
├── .claude/                    # Bộ khung Harness cho Claude Code
│   ├── settings.json           # Cấu hình quyền và công cụ cho Claude Code
│   ├── rules/                  # Quy tắc chuyên biệt (rules-of-hooks, git-safety, rtk)
│   ├── skills/                 # Kỹ năng nghiệp vụ chuyên biệt
│   ├── agents/                 # Định nghĩa prompt cho các subagent
│   ├── agent-memory/           # Bộ nhớ bền vững giữa các phiên chạy
│   ├── workflows/              # Luồng thực thi công việc tự động hoá
│   └── output-styles/          # Định dạng phong cách đầu ra chuẩn
│
├── contexte/                   # Bộ nhớ tri thức lâu dài AI học được qua từng phiên
│   ├── README.md               # Hướng dẫn ghi nhận tri thức dự án
│   ├── architecture.md         # Kiến trúc hệ thống, luồng dữ liệu & bảo mật RLS
│   ├── storefront-ordering.md  # Nghiệp vụ đặt hàng theo set, tính giá, mã QR Napas EMVCo
│   └── rules-of-hooks-incident.md # Bài học xương máu về lỗi Hooks sau return sớm
│
├── sources/                    # Tài liệu thô và nguyên liệu đầu vào từ người dùng
│   └── README.md               # Mô tả vai trò và quy tắc lưu trữ tài liệu thô
│
├── livrables/                  # Các sản phẩm kết xuất hoàn thiện do AI tạo ra
│   └── README.md               # Mô tả kho lưu trữ thành phẩm đầu ra
│
├── docs/                       # Tài liệu hướng dẫn sử dụng & vận hành
│   ├── README.md               # Mục lục tài liệu dự án
│   ├── sync-guide.md           # Hướng dẫn đồng bộ mã nguồn giữa nhiều thiết bị
│   └── worktree-guide.md       # Hướng dẫn chi tiết kỹ thuật Git Worktree đa phiên
│
├── scripts/                    # Các script tự động hoá tiện ích
│   ├── check-i18n.mjs          # Script quét kiểm tra thiếu sót khoá ngôn ngữ i18n
│   └── worktree.sh             # Script hỗ trợ tạo/xoá git worktree và sync file cấu hình
│
├── public/                     # Tài nguyên tĩnh phục vụ web
│   ├── shop/                   # Hình ảnh vector SVG minh hoạ món ăn đồng bộ thương hiệu
│   │   ├── flavor-truyen-thong.svg   # Sữa chua vị Truyền thống
│   │   ├── flavor-pho-mai.svg        # Sữa chua vị Phô mai
│   │   ├── flavor-nep-cam.svg        # Sữa chua vị Nếp cẩm
│   │   ├── flavor-matcha.svg         # Sữa chua vị Matcha
│   │   ├── flavor-ca-cao.svg         # Sữa chua vị Ca cao
│   │   ├── flavor-banh-flan.svg      # Bánh flan caramel
│   │   ├── flavor-hy-lap.svg         # Sữa chua Hy Lạp (hũ làm quen 110g)
│   │   ├── flavor-hy-lap-400.svg     # Sữa chua Hy Lạp (hũ tri kỷ 400g)
│   │   ├── flavor-whey.svg           # Nước whey đóng chai 220ml
│   │   ├── hero.svg                  # Tranh minh hoạ chính ở banner trang chủ
│   │   └── hogi-logo.svg             # Logo thương hiệu Hogi Food
│   └── _redirects              # Định tuyến SPA cho Cloudflare Pages / Netlify
│
├── src/                        # Mã nguồn ứng dụng Frontend
│   ├── main.tsx                # Điểm khởi động ứng dụng React
│   ├── App.tsx                 # Thiết lập Router và Context Providers
│   ├── globals.d.ts            # Khai báo __BUILD_ID__ do vite.config.ts gắn lúc build
│   ├── index.css               # Toàn bộ CSS phong cách giao diện và layout
│   ├── types/                  # Định nghĩa kiểu dữ liệu TypeScript (database, domain)
│   ├── i18n/                   # Từ điển 5 ngôn ngữ (vi, en, ko, zh, ja)
│   ├── lib/                    # Thư viện xử lý logic thuần (tính toán, QR, storefront)
│   │   ├── storefront.ts       # Logic giỏ hàng, bảng giá set, nhận diện vị món
│   │   ├── emvQr.ts            # Tạo chuỗi thanh toán mã QR EMVCo chuẩn Napas
│   │   ├── invoiceImage.ts     # Vẽ hoá đơn bán hàng ra file ảnh PNG bằng Canvas
│   │   ├── appVersion.ts       # So mã build đang chạy với /version.json trên server (phát hiện bản mới sau deploy)
│   │   └── companySalesHistory.ts # Tổng hợp lịch sử đơn bán kênh Công ty (khối trong tab Báo cáo, pages/CompanySalesHistory.tsx)
│   ├── components/             # Các component tái sử dụng (Header, CartModal, Settings, UpdateWatcher tự tải lại khi có bản mới...)
│   └── pages/                  # Các trang màn hình giao diện (ShopPage, Revenue, Expenses...)
│
├── supabase/                   # Cấu hình và mã nguồn Backend Supabase
│   ├── config.toml             # Cấu hình dự án Supabase cục bộ
│   ├── migrations/             # Các file migration SQL (gồm 20261025250000_enable_vault.sql kích hoạt Supabase Vault)
│   └── functions/              # Edge Functions chạy trên nền tảng Deno
│       ├── admin-users/        # Quản lý tài khoản nhân viên
│       └── chat-assistant/     # Trợ lý AI phân tích số liệu bán hàng
│
└── .github/                    # Tác vụ CI/CD tự động
    └── workflows/
        └── keep-supabase-alive.yml # Workflow tự động giữ instance Supabase miễn phí không bị ngủ
```

---

## 📌 Hướng dẫn tra cứu & lưu trữ

1. **Tìm tài liệu nghiệp vụ**: Xem [`SPEC.md`](SPEC.md) và các tài liệu sâu trong [`contexte/`](contexte/).
2. **Tìm logic tính toán**: Xem các file unit test song hành trong [`src/lib/*.test.ts`](src/lib/).
3. **Thêm tài liệu tham khảo đầu vào**: Lưu vào thư mục [`sources/`](sources/).
4. **Lưu kết quả phân tích / báo cáo xuất bản**: Lưu vào thư mục [`livrables/`](livrables/).
5. **Cần mở nhiều cửa sổ làm việc song song**: Đọc [`WORKTREE.md`](WORKTREE.md) trước khi thao tác.
