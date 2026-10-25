# AGENTS.md — Quy tắc chung cho toàn bộ Agent & Subagent

Tài liệu này là hợp đồng kỷ luật bắt buộc cho mọi Agent, Subagent hoặc quy trình tự động hoá làm việc trên codebase **web-nhap-lieu**.

---

## 1. Nguyên tắc làm việc cốt lõi

1. **Hiểu rõ ranh giới & Phạm vi**:
   - Chỉ sửa đổi những file thực sự liên quan đến mục tiêu được giao.
   - Không tự ý tái cấu trúc (refactor) lan man sang các module khác ngoài phạm vi yêu cầu.
   - Bảo tồn toàn bộ ghi chú (comments) và docstrings hiện có nếu không trực tiếp thay đổi logic đó.

2. **Kỷ luật kiểm thử trước khi báo cáo hoàn thành**:
   Mọi Agent khi thực hiện code hoặc refactor **bắt buộc** phải tự chạy và xác nhận 5 lệnh kiểm tra sau đạt trạng thái hoàn toàn sạch trước khi bàn giao:
   ```bash
   yarn tsc -b
   yarn lint
   yarn test
   yarn i18n:check
   yarn build
   ```

3. **Nguyên tắc an toàn Hooks tuyệt đối**:
   - Tuyệt đối không đặt Hook (`useMemo`, `useState`, `useEffect`, `useCallback`) sau bất kỳ lệnh `return` sớm nào hoặc bên trong các khối điều kiện `if`.
   - Luôn đặt toàn bộ Hook ở cấp cao nhất của component.

4. **Nguyên tắc an toàn dữ liệu & Database**:
   - Không chạy bất kỳ câu lệnh nào trực tiếp can thiệp phá huỷ dữ liệu Supabase.
   - Mọi thay đổi schema đều phải qua file SQL trong `supabase/migrations/` và tuân theo chuẩn Postgres idempotent (`IF NOT EXISTS`, `OR REPLACE`).

5. **Nguyên tắc an toàn Git**:
   - Không bao giờ thêm các file cấu hình máy dev hoặc secret (`.agents/`, `.claude/settings.local.json`, `skills-lock.json`, `.env*`) vào git commit.
   - Không dùng cờ `--force`.
   - Không can thiệp vào `~/.ssh`, `~/.gitconfig` hay cấu hình remote của người dùng.

---

## 2. Phân chia vai trò Subagents

| Subagent | Trách nhiệm chính | Công cụ cấp phép |
|---|---|---|
| `research` | Khảo sát codebase, tra cứu logic hiện có, đọc log và tài liệu | Chỉ đọc (Read-only) |
| `code-reviewer` | Đánh giá chất lượng code, kiểm tra vi phạm Rules of Hooks, kiểm tra type và hiệu năng | Đọc code, chạy linter, chạy test |
| `visual-designer` | Thiết kế minh hoạ vector SVG cho món ăn, tối ưu CSS giao diện | Tạo/sửa SVG, render headless Chrome kiểm tra |
| `database-guard` | Soạn thảo migration SQL, kiểm tra RLS policies, index tối ưu | Đọc/viết migrations, tuân thủ supabase-postgres-best-practices |

---

## 3. Quy trình phản hồi & Bàn giao

- Giữ nội dung phản hồi ngắn gọn, súc tích, định dạng Markdown rõ ràng.
- Luôn tạo clickable link cho các file và biểu tượng code theo chuẩn `[ten-file](file:///duong/dan/tuyet/doi)`.
- Liệt kê minh bạch kết quả từng lệnh kiểm tra và mã commit (nếu có).
