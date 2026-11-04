-- Sửa lỗi "permission denied for table stock_disposals" ở Nhập liệu > Hàng huỷ.
-- Migration 20261104090000 bật RLS + policy SELECT nhưng quên cấp quyền bảng cho role authenticated
-- (dự án đã revoke quyền mặc định, mỗi bảng phải grant tường minh). Ghi / xoá vẫn chỉ qua RPC
-- create_stock_disposal / delete_stock_disposal nên chỉ cấp SELECT; RLS lọc theo quán / admin.

revoke all on table public.stock_disposals, public.stock_disposal_lines from public, anon;
grant select on public.stock_disposals to authenticated;
grant select on public.stock_disposal_lines to authenticated;
