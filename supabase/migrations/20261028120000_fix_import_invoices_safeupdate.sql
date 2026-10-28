-- Sửa import_revenue_invoices báo lỗi "DELETE requires a WHERE clause" (pg-safeupdate của Supabase chặn DELETE không có WHERE)
-- khi nhập file hoá đơn POS: dọn bảng tạm bằng TRUNCATE thay vì DELETE không điều kiện. Phần còn lại giữ nguyên.
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
  truncate table pg_temp.import_keys;

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
