-- =============================================================================
-- Tổng kết mặt hàng đã bán theo tháng (quán Bún đậu), nhập từ báo cáo mặt hàng của máy POS.
--   * Mỗi (cửa hàng, tháng, mã mặt hàng) một dòng; nhập lại thì ghi đè.
--   * period_end: dữ liệu tính đến ngày nào (tháng đang chạy chưa đủ ngày).
--   * Chỉ admin đọc / ghi; không liên quan tới bảng products / sales (quán không bán theo món trong app nữa).
-- =============================================================================

create table public.monthly_item_sales (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id),
  month       date not null check (month = date_trunc('month', month)::date),
  period_end  date not null,
  category    text,
  item_code   text not null,
  item_name   text not null,
  qty         numeric(12,2) not null check (qty >= 0),
  gross       numeric(14,2) not null check (gross >= 0),
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  net         numeric(14,2) not null check (net >= 0),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint monthly_item_sales_unique unique (store_id, month, item_code)
);
create index monthly_item_sales_created_by_idx on public.monthly_item_sales (created_by);

alter table public.monthly_item_sales enable row level security;

grant select, insert, update, delete on public.monthly_item_sales to authenticated;

create policy monthly_item_sales_select_admin on public.monthly_item_sales
  for select to authenticated using ((select public.is_admin()));
create policy monthly_item_sales_insert_admin on public.monthly_item_sales
  for insert to authenticated with check ((select public.is_admin()) and created_by = (select auth.uid()));
create policy monthly_item_sales_update_admin on public.monthly_item_sales
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy monthly_item_sales_delete_admin on public.monthly_item_sales
  for delete to authenticated using ((select public.is_admin()));
