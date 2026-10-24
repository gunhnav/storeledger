-- =============================================================================
-- Thêm kênh doanh thu "Bán nem cuốn" (nem cuốn / chả giò bán riêng, không đi qua máy POS) vào doanh thu theo ngày.
--   * daily_revenue.channel: in_store (Quán), shopeefood (Đối tác app), nem_cuon (Bán nem cuốn).
--   * revenue_invoices.channel giữ nguyên (hoá đơn POS chỉ có Quán / Đối tác).
-- =============================================================================

alter table public.daily_revenue drop constraint daily_revenue_channel_check;
alter table public.daily_revenue
  add constraint daily_revenue_channel_check check (channel in ('in_store', 'shopeefood', 'nem_cuon'));
