-- =============================================================================
-- Tổng kết mặt hàng theo khoảng ngày (một ngày hoặc cả tháng) thay vì chỉ cả tháng.
--   * period_start: ngày đầu của báo cáo POS (cả tháng = ngày 1, báo cáo một ngày = period_start = period_end).
--   * Khoá trùng đổi thành (cửa hàng, period_start, mã mặt hàng): nhập lại báo cáo cùng ngày đầu thì là cập nhật
--     (period_end có thể dài ra khi tháng đang chạy), màn hình cảnh báo trước khi ghi đè.
--   * month giữ nguyên (tháng của period_start) để lọc theo tháng.
-- =============================================================================

alter table public.monthly_item_sales add column if not exists period_start date;
update public.monthly_item_sales set period_start = month where period_start is null;
alter table public.monthly_item_sales alter column period_start set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'monthly_item_sales_period_check') then
    alter table public.monthly_item_sales
      add constraint monthly_item_sales_period_check
      check (period_start >= month and period_start < (month + interval '1 month')::date and period_end >= period_start);
  end if;
  if exists (select 1 from pg_constraint where conname = 'monthly_item_sales_unique') then
    alter table public.monthly_item_sales drop constraint monthly_item_sales_unique;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monthly_item_sales_unique') then
    alter table public.monthly_item_sales add constraint monthly_item_sales_unique unique (store_id, period_start, item_code);
  end if;
end $$;

create index if not exists monthly_item_sales_store_period_idx on public.monthly_item_sales (store_id, period_start, period_end);
