# WORKTREE.md — Quy tắc chạy đa nhiệm song song (Git Worktree)

> **Mục tiêu**: Cho phép mở nhiều phiên làm việc cùng lúc với Claude Code / AI assistants (ví dụ: 1 phiên làm bug UI, 1 phiên viết migration, 1 phiên viết test) trên cùng một máy mà **tuyệt đối không bị xung đột (conflict) mã nguồn**.

---

## 1. Nguyên tắc vàng

1. **Một phiên = Một Worktree = Một Branch riêng**:
   - Tuyệt đối không mở hai phiên Claude làm việc trên cùng một thư mục hoặc cùng một nhánh git.
2. **Không commit trực tiếp lên `master` khi làm việc nhóm / song song**:
   - Luôn làm việc trên nhánh tính năng (feature branch), kiểm tra sạch sẽ rồi mới gộp (merge hoặc PR).
3. **Các file cần sao chép theo phiên**:
   - Được định nghĩa trong [`.worktreeinclude`](.worktreeinclude) (bao gồm `.env.local`, `CLAUDE.local.md`).

---

## 2. Các lệnh thao tác nhanh

### Tạo một phiên làm việc mới:
```bash
# Cú pháp: git worktree add ../<tên-thư-mục-mới> -b <tên-nhánh-mới>
git worktree add ../web-feat-mobile-ui -b feat/mobile-ui

# Sao chép các file cấu hình và biến môi trường cần thiết
cp .env.local ../web-feat-mobile-ui/
cp .oxlintrc.json ../web-feat-mobile-ui/ 2>/dev/null || true

# Chuyển vào thư mục mới và mở Claude Code
cd ../web-feat-mobile-ui
yarn install
```

Hoặc sử dụng script tự động có sẵn trong repo:
```bash
./scripts/worktree.sh add feat/mobile-ui
```

### Xem danh sách các phiên đang chạy:
```bash
git worktree list
```

### Dọn dẹp phiên sau khi hoàn thành:
Sau khi đã merge hoặc push nhánh lên remote:
```bash
# Quay về thư mục chính
cd /home/hung-nguyen26/Desktop/web-nhap-lieu

# Xoá worktree
git worktree remove ../web-feat-mobile-ui

# Hoặc dùng script tiện ích
./scripts/worktree.sh remove feat/mobile-ui
```

---

## 3. Quy trình làm việc an toàn trên từng Worktree

1. Vào thư mục worktree riêng biệt.
2. Yêu cầu AI thực hiện task cụ thể.
3. Chạy đủ bộ 5 lệnh kiểm tra chất lượng:
   ```bash
   yarn tsc -b && yarn lint && yarn test && yarn i18n:check && yarn build
   ```
4. Commit sạch sẽ và đẩy nhánh lên GitHub.
5. Về lại nhánh chính để rebase/merge hoặc tạo Pull Request.
