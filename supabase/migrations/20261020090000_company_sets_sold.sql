-- =============================================================================
-- Set công ty đã bán thì không hiện nữa.
--   * company_sets.sold_count: số set đã bán của nhóm; get_company_sets chỉ trả nhóm còn set
--     và set_count = số set còn lại.
--   * create_company_sale: một giao dịch = trừ set (cũ nhất trước) + tạo đơn bán kênh công ty,
--     lỗi thì không ghi gì.
-- p_sets: [{ "size": 4, "mix": { "<product_id>": số hũ, ... }, "count": số set bán }]
-- =============================================================================

alter table public.company_sets
  add column if not exists sold_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_sets_sold_count_check') then
    alter table public.company_sets add constraint company_sets_sold_count_check check (sold_count >= 0 and sold_count <= set_count);
  end if;
end $$;

-- Đơn đã bán trước khi có cột này: hai set 4 (mix 1-1-1-1 và 1-1-2) đã bán ngày 2026-10-20
update public.company_sets set sold_count = 1
where id in ('6c056c24-6a55-47e4-9ec7-956b0884b5ea', 'd1153dfd-4feb-4884-aeff-ac7a2517b1f5');

drop function if exists public.get_company_sets(uuid, integer);
create or replace function public.get_company_sets(p_store_id uuid, p_days integer default 90)
returns table (
  id                 uuid,
  distribution_date  date,
  set_size           integer,
  set_count          integer,
  mix                jsonb,
  note               text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền xem cửa hàng này' using errcode = '42501';
  end if;

  return query
  select cs.id, cs.distribution_date, cs.set_size, cs.set_count - cs.sold_count, cs.mix, cs.note
  from public.company_sets cs
  where cs.store_id = p_store_id
    and cs.set_count > cs.sold_count
    and cs.distribution_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - greatest(coalesce(p_days, 90), 1)
  order by cs.distribution_date desc, cs.created_at desc;
end;
$$;

revoke execute on function public.get_company_sets(uuid, integer) from public, anon;
grant execute on function public.get_company_sets(uuid, integer) to authenticated;

create or replace function public.create_company_sale(
  p_store_id   uuid,
  p_sale_date  date,
  p_note       text,
  p_items      jsonb,
  p_sets       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pick    jsonb;
  v_need    integer;
  v_row     record;
  v_take    integer;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'Chưa chọn set nào để bán';
  end if;

  for v_pick in select e.value from jsonb_array_elements(p_sets) as e(value) loop
    v_need := (v_pick ->> 'count')::integer;
    if v_need is null or v_need <= 0 then
      raise exception 'Số set phải là số nguyên > 0';
    end if;
    -- Trừ vào các nhóm cùng cỡ + cùng thành phần, nhóm phân phối cũ trước
    for v_row in
      select cs.id, cs.set_count - cs.sold_count as remaining
      from public.company_sets cs
      where cs.store_id = p_store_id
        and cs.set_size = (v_pick ->> 'size')::integer
        and cs.mix = (v_pick -> 'mix')
        and cs.set_count > cs.sold_count
      order by cs.distribution_date, cs.created_at
      for update
    loop
      exit when v_need = 0;
      v_take := least(v_need, v_row.remaining);
      update public.company_sets set sold_count = sold_count + v_take where id = v_row.id;
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception 'Không đủ set để bán (thiếu % set)', v_need;
    end if;
  end loop;

  return public.create_sale(p_store_id, p_sale_date, 'company', p_note, p_items);
end;
$$;

revoke execute on function public.create_company_sale(uuid, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_company_sale(uuid, date, text, jsonb, jsonb) to authenticated;
