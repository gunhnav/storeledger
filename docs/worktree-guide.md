# Cẩm nang chạy song song nhiều phiên với Git Worktree

Tài liệu hướng dẫn chi tiết cách thiết lập môi trường đa nhiệm cho Claude Code / AI assistants.

---

## 1. Tại sao cần Git Worktree?

Khi làm việc với các dự án lớn, việc chỉ sử dụng một thư mục gốc duy nhất dẫn đến việc:
- Không thể mở 2 phiên Claude Code cùng lúc vì 2 phiên sẽ ghi đè file của nhau.
- Phải chuyển branch liên tục (`git checkout`), làm gián đoạn dev server và build cache.

Với **Git Worktree**, Git cho phép gắn nhiều nhánh (branch) khác nhau vào các thư mục độc lập trên ổ đĩa từ cùng một kho chứa (local git repository).

---

## 2. Quy trình 4 bước thực hiện

```text
/home/hung-nguyen26/Desktop/
├── web-nhap-lieu/             # Thư mục chính (nhánh master)
├── web-feat-mobile-cart/       # Worktree 1: Nhánh feat/mobile-cart (Phiên Claude 1)
└── web-fix-emv-qr/             # Worktree 2: Nhánh fix/emv-qr (Phiên Claude 2)
```

### Bước 1: Khởi tạo Worktree mới
Từ thư mục chính `web-nhap-lieu`:
```bash
./scripts/worktree.sh add feat/mobile-cart
```
Script sẽ tự động:
- Tạo nhánh mới `feat/mobile-cart`
- Tạo thư mục `../web-feat-mobile-cart`
- Sao chép toàn bộ file cấu hình trong `.worktreeinclude` (`.env.local`, `.oxlintrc.json`, `CLAUDE.local.md`) sang thư mục mới.

### Bước 2: Bật phiên Claude Code
Mở terminal riêng biệt:
```bash
cd ../web-feat-mobile-cart
claude
```
Bây giờ, phiên Claude này hoàn toàn độc lập với phiên ở thư mục chính.

### Bước 3: Kiểm tra chất lượng & Commit
Trong thư mục worktree:
```bash
yarn tsc -b && yarn lint && yarn test && yarn i18n:check && yarn build
git commit -m "feat: cai thien giao dien gio hang mobile"
git push origin feat/mobile-cart
```

### Bước 4: Dọn dẹp sau khi gộp nhánh
Khi tính năng đã được merge vào `master`:
```bash
cd /home/hung-nguyen26/Desktop/web-nhap-lieu
./scripts/worktree.sh remove feat/mobile-cart
```
Thao tác này sẽ giải phóng thư mục mà không làm mất lịch sử git.
