# Hướng dẫn đồng bộ giữa nhiều thiết bị

Tóm tắt quy trình làm việc trên nhiều máy (ví dụ: máy công ty & máy ở nhà) trong 3 câu đơn giản:

1. **Lưu tại máy hiện tại**: Chạy `yarn build` kiểm tra sạch sẽ, sau đó `git add -A && git commit -m "..." && git push origin <branch>`.
2. **Kéo về tại máy mới**: Chạy `git pull origin <branch>` (hoặc `git clone` nếu là lần đầu) và `yarn install`.
3. **Biến môi trường (Secrets)**: Vì `.env.local` không được đẩy lên Git, hãy sao chép từ `.env.example` thành `.env.local` trên máy mới rồi điền các khoá Supabase tương ứng.
