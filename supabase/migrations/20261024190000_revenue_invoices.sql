-- =============================================================================
-- Hoá đơn POS đã nhập (quán Bún đậu) để nhập file doanh thu không bị trùng.
--   * revenue_invoices: mỗi hoá đơn một dòng, khoá trùng là (cửa hàng, mã hoá đơn).
--   * import_revenue_invoices: thêm / sửa các hoá đơn được gửi lên, rồi tính lại doanh thu từng (ngày, kênh) bị ảnh hưởng
--     trong daily_revenue = tổng "tiền thanh toán" của các hoá đơn đã thanh toán (đơn huỷ không tính).
--     Việc chọn hoá đơn nào thêm, hoá đơn nào ghi đè do màn hình quyết định sau khi cảnh báo người dùng.
--   * Chỉ admin đọc / ghi.
-- =============================================================================

create table public.revenue_invoices (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores (id),
  invoice_code    text not null check (char_length(btrim(invoice_code)) between 1 and 40),
  status          text not null check (status in ('Đã thanh toán', 'Đã hủy')),
  source          text,
  payment_method  text,
  channel         text not null default 'in_store' check (channel in ('in_store', 'shopeefood')),
  revenue_date    date not null,
  created_time    timestamp,
  paid_time       timestamp,
  goods_total     numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0,
  total_paid      numeric(14,2) not null check (total_paid >= 0),
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint revenue_invoices_unique unique (store_id, invoice_code)
);
create index revenue_invoices_store_date_idx on public.revenue_invoices (store_id, revenue_date);
create index revenue_invoices_created_by_idx on public.revenue_invoices (created_by);

alter table public.revenue_invoices enable row level security;
revoke all on table public.revenue_invoices from public, anon;
grant select, insert, update, delete on public.revenue_invoices to authenticated;
create policy revenue_invoices_admin on public.revenue_invoices
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- p_rows: [{ invoice_code, status, source, payment_method, channel, revenue_date, created_time, paid_time, goods_total, discount, total_paid }]
-- Trả về { inserted, updated, days } (days = số dòng daily_revenue được tính lại)
create or replace function public.import_revenue_invoices(p_store_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row       jsonb;
  v_inserted  integer := 0;
  v_updated   integer := 0;
  v_days      integer := 0;
  v_old       record;
  v_key       record;
  v_total     numeric;
  v_count     integer;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được nhập hoá đơn' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Chưa có hoá đơn nào để nhập';
  end if;

  create temporary table if not exists pg_temp.import_keys (revenue_date date, channel text, unique (revenue_date, channel)) on commit drop;
  delete from pg_temp.import_keys;

  for v_row in select e.value from jsonb_array_elements(p_rows) as e(value) loop
    select i.revenue_date, i.channel into v_old
    from public.revenue_invoices i
    where i.store_id = p_store_id and i.invoice_code = v_row ->> 'invoice_code';

    if found then
      insert into pg_temp.import_keys values (v_old.revenue_date, v_old.channel) on conflict do nothing;
      v_updated := v_updated + 1;
    else
      v_inserted := v_inserted + 1;
    end if;

    insert into public.revenue_invoices (store_id, invoice_code, status, source, payment_method, channel, revenue_date,
                                         created_time, paid_time, goods_total, discount, total_paid)
    values (p_store_id, v_row ->> 'invoice_code', v_row ->> 'status', nullif(v_row ->> 'source', ''),
            nullif(v_row ->> 'payment_method', ''), coalesce(v_row ->> 'channel', 'in_store'), (v_row ->> 'revenue_date')::date,
            nullif(v_row ->> 'created_time', '')::timestamp, nullif(v_row ->> 'paid_time', '')::timestamp,
            coalesce((v_row ->> 'goods_total')::numeric, 0), coalesce((v_row ->> 'discount')::numeric, 0), (v_row ->> 'total_paid')::numeric)
    on conflict (store_id, invoice_code) do update set
      status = excluded.status, source = excluded.source, payment_method = excluded.payment_method, channel = excluded.channel,
      revenue_date = excluded.revenue_date, created_time = excluded.created_time, paid_time = excluded.paid_time,
      goods_total = excluded.goods_total, discount = excluded.discount, total_paid = excluded.total_paid;

    insert into pg_temp.import_keys values ((v_row ->> 'revenue_date')::date, coalesce(v_row ->> 'channel', 'in_store')) on conflict do nothing;
  end loop;

  for v_key in select k.revenue_date, k.channel from pg_temp.import_keys k loop
    select coalesce(sum(i.total_paid), 0), count(*) into v_total, v_count
    from public.revenue_invoices i
    where i.store_id = p_store_id and i.revenue_date = v_key.revenue_date and i.channel = v_key.channel and i.status = 'Đã thanh toán';

    if v_count > 0 then
      insert into public.daily_revenue (store_id, revenue_date, channel, amount, note)
      values (p_store_id, v_key.revenue_date, v_key.channel, v_total, format('Từ hóa đơn POS (%s đơn)', v_count))
      on conflict (store_id, revenue_date, channel) do update set amount = excluded.amount, note = excluded.note;
    else
      delete from public.daily_revenue d
      where d.store_id = p_store_id and d.revenue_date = v_key.revenue_date and d.channel = v_key.channel and d.note like '%hóa đơn POS%';
    end if;
    v_days := v_days + 1;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'days', v_days);
end;
$$;
revoke execute on function public.import_revenue_invoices(uuid, jsonb) from public, anon;
grant execute on function public.import_revenue_invoices(uuid, jsonb) to authenticated;
