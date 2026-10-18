-- =============================================================================
-- company_sets — Lưu các set (set 4 / set 6, mix nhiều vị) khi phân phối cho Công ty,
-- để trang Bán hàng (kênh Công ty) hiện lại đúng các set đã phân phối.
--   * Bảng company_sets: mỗi dòng là một nhóm "N set cỡ 4/6" với số hũ từng vị trong 1 set (mix jsonb).
--     Bật RLS, KHÔNG cấp quyền bảng cho anon / authenticated: chỉ đọc / ghi qua hàm SECURITY DEFINER.
--   * create_company_distribution: kiểm tra set rồi phân phối cho công ty trong MỘT giao dịch
--     (gọi create_transfer với nơi nhận 'company' cho từng vị) và lưu các nhóm set.
--     Lỗi ở bất kỳ vị nào thì không ghi gì (trước đây app gọi từng vị, có thể lưu dở).
--   * get_company_sets: các set đã phân phối của cửa hàng (chỉ số lượng, không có giá vốn).
-- =============================================================================

create table public.company_sets (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores (id),
  distribution_date  date not null,
  set_size           integer not null check (set_size in (4, 6)),
  set_count          integer not null check (set_count > 0 and set_count <= 10000),
  -- {"<product_id>": số hũ trong 1 set, ...}; tổng bằng set_size
  mix                jsonb not null,
  note               text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index company_sets_store_date_idx on public.company_sets (store_id, distribution_date desc);

alter table public.company_sets enable row level security;
revoke all on table public.company_sets from public, anon, authenticated;

comment on table public.company_sets is 'Các set (4/6 hũ, mix vị) đã phân phối cho công ty; ghi / đọc qua create_company_distribution, get_company_sets';

create or replace function public.create_company_distribution(
  p_store_id  uuid,
  p_date      date,
  p_note      text,
  p_groups    jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group    jsonb;
  v_size     integer;
  v_count    integer;
  v_mix      jsonb;
  v_key      text;
  v_qty      integer;
  v_sum      integer;
  v_product  record;
  v_totals   jsonb := '{}'::jsonb;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception 'Chưa có set nào';
  end if;

  -- Kiểm tra từng nhóm set và cộng tổng hũ từng vị
  for v_group in select e.value from jsonb_array_elements(p_groups) as e(value) loop
    v_size  := (v_group ->> 'size')::integer;
    v_count := (v_group ->> 'count')::integer;
    v_mix   := v_group -> 'mix';
    if v_size is null or v_size not in (4, 6) then
      raise exception 'Cỡ set chỉ nhận 4 hoặc 6';
    end if;
    if v_count is null or v_count <= 0 or v_count > 10000 then
      raise exception 'Số set phải là số nguyên > 0';
    end if;
    if v_mix is null or jsonb_typeof(v_mix) <> 'object' then
      raise exception 'Set chưa có vị nào';
    end if;

    v_sum := 0;
    for v_key, v_qty in select k, (v)::text::integer from jsonb_each(v_mix) as m(k, v) loop
      if v_qty is null or v_qty < 0 then
        raise exception 'Số hũ mỗi vị phải là số nguyên';
      end if;
      continue when v_qty = 0;
      select p.name, p.tracks_stock, p.is_active into v_product
      from public.products p
      where p.id = v_key::uuid and p.store_id = p_store_id;
      if not found then
        raise exception 'Sản phẩm % không thuộc cửa hàng này', v_key;
      end if;
      v_sum := v_sum + v_qty;
      v_totals := jsonb_set(v_totals, array[v_key], to_jsonb(coalesce((v_totals ->> v_key)::integer, 0) + v_qty * v_count));
    end loop;
    if v_sum <> v_size then
      raise exception 'Mỗi set % hũ nhưng đang chọn % hũ', v_size, v_sum;
    end if;
  end loop;

  -- Phân phối từng vị (create_transfer kiểm tra quyền, tồn ở nhà, ngày, món đếm tồn / đang bán)
  for v_key, v_qty in select k, (v)::text::integer from jsonb_each(v_totals) as t(k, v) loop
    perform public.create_transfer(p_store_id, v_key::uuid, v_qty, p_date, v_note, 'company');
  end loop;

  insert into public.company_sets (store_id, distribution_date, set_size, set_count, mix, note, created_by)
  select
    p_store_id,
    coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
    (e.value ->> 'size')::integer,
    (e.value ->> 'count')::integer,
    (select coalesce(jsonb_object_agg(m.k, m.v), '{}'::jsonb)
       from jsonb_each(e.value -> 'mix') as m(k, v)
      where (m.v)::text::integer > 0),
    v_note,
    auth.uid()
  from jsonb_array_elements(p_groups) as e(value);
end;
$$;

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
  select cs.id, cs.distribution_date, cs.set_size, cs.set_count, cs.mix, cs.note
  from public.company_sets cs
  where cs.store_id = p_store_id
    and cs.distribution_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - greatest(coalesce(p_days, 90), 1)
  order by cs.distribution_date desc, cs.created_at desc;
end;
$$;

revoke execute on function public.create_company_distribution(uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_company_distribution(uuid, date, text, jsonb) to authenticated;
revoke execute on function public.get_company_sets(uuid, integer) from public, anon;
grant execute on function public.get_company_sets(uuid, integer) to authenticated;

-- Dữ liệu cũ: lần phân phối cho công ty ngày 19/10/2026 của Hogi (ghi trước khi có bảng này)
-- chỉ lưu set trong ghi chú "1 set 4 (1 Matcha + 1 Phô mai + 1 Nếp cẩm + 1 Truyền thống) + ...".
-- Chép lại 3 nhóm set đó (tra mã món theo tên trong cửa hàng Hogi) để Bán hàng hiện được.
insert into public.company_sets (store_id, distribution_date, set_size, set_count, mix, note, created_by)
select s.id, date '2026-10-19', 4, 1, g.mix, t.note, t.created_by
from public.stores s
cross join lateral (
  select t.note, t.created_by
  from public.stock_transfers t
  where t.store_id = s.id and t.destination = 'company' and t.transfer_date = date '2026-10-19'
  order by t.created_at
  limit 1
) t
cross join lateral (
  values
    (jsonb_build_object(
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Matcha')::text, 1,
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Phô mai')::text, 1,
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Nếp cẩm')::text, 1,
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Truyền thống')::text, 1)),
    (jsonb_build_object(
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Truyền thống')::text, 2,
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Nếp cẩm')::text, 1,
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Phô mai')::text, 1)),
    (jsonb_build_object(
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Truyền thống')::text, 2,
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Matcha')::text, 1,
       (select p.id from public.products p where p.store_id = s.id and p.name = 'Phô mai')::text, 1))
) as g(mix)
where s.code = 'hogi'
  and t.note like '1 set 4 (1 Matcha + 1 Phô mai + 1 Nếp cẩm + 1 Truyền thống)%';
