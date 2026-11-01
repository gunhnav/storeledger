-- =============================================================================
-- Thêm kênh doanh thu "Bán dầu đen" (dầu ăn đã qua sử dụng bán riêng, không đi qua máy POS) vào doanh thu theo ngày.
--   * daily_revenue.channel: in_store (Quán), shopeefood (Đối tác app), nem_cuon (Bán nem cuốn), dau_den (Bán dầu đen).
--   * Không có hoa hồng, không tính vào so khớp với doanh thu POS (giống nem_cuon).
-- =============================================================================

alter table public.daily_revenue drop constraint if exists daily_revenue_channel_check;
alter table public.daily_revenue
  add constraint daily_revenue_channel_check check (channel in ('in_store', 'shopeefood', 'nem_cuon', 'dau_den'));
