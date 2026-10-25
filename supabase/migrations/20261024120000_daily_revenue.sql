-- =============================================================================
-- Doanh thu nhập tay theo ngày và kênh (quán Bún đậu không bán theo món nữa).
--   * Mỗi (cửa hàng, ngày, kênh) một dòng: nhập lại cùng ngày + kênh thì ghi đè, không cộng đôi.
--   * channel: 'in_store' (Quán) hoặc 'shopeefood' (Đối tác app; hoa hồng = tỷ lệ mặc định của cửa hàng, tính khi xem báo cáo).
--   * Chỉ admin đọc / ghi (giống chi phí); nhân viên không thấy doanh thu tổng hợp.
--   * Dữ liệu bán theo món cũ (sales, sale_items) giữ nguyên, chỉ không còn hiện ở màn hình của Bún đậu.
-- =============================================================================

create table if not exists public.daily_revenue (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id),
  revenue_date  date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  channel       text not null default 'in_store' check (channel in ('in_store', 'shopeefood')),
  amount        numeric(14,2) not null check (amount >= 0 and amount <= 1000000000),
  note          text,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint daily_revenue_unique unique (store_id, revenue_date, channel),
  constraint daily_revenue_not_future check (revenue_date <= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
);
create index if not exists daily_revenue_created_by_idx on public.daily_revenue (created_by);

alter table public.daily_revenue enable row level security;

grant select, insert, update, delete on public.daily_revenue to authenticated;

drop policy if exists daily_revenue_select_admin on public.daily_revenue;
create policy daily_revenue_select_admin on public.daily_revenue
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists daily_revenue_insert_admin on public.daily_revenue;
create policy daily_revenue_insert_admin on public.daily_revenue
  for insert to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

drop policy if exists daily_revenue_update_admin on public.daily_revenue;
create policy daily_revenue_update_admin on public.daily_revenue
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists daily_revenue_delete_admin on public.daily_revenue;

create policy daily_revenue_delete_admin on public.daily_revenue
  for delete to authenticated
  using ((select public.is_admin()));

create or replace function public.daily_revenue_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists daily_revenue_touch on public.daily_revenue;
create trigger daily_revenue_touch before update on public.daily_revenue
  for each row execute function public.daily_revenue_touch();
