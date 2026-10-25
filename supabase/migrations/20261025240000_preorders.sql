-- =============================================================================
-- Đơn đặt trước từ trang bán hàng công khai: lưu RIÊNG, không dính tới bán hàng / kho / chi phí / báo cáo của app nhập liệu.
--   * stores.public_floors: các tầng được giao (vd: 6, 7, 8, 9, 11, 12); null = không giới hạn.
--   * preorders: mỗi đơn một dòng, chụp lại các món và giá lúc đặt; trạng thái new -> confirmed -> paid -> delivered / cancelled.
--   * submit_preorder (khách không đăng nhập gọi được): kiểm tra thông tin, TÍNH LẠI GIÁ trên máy chủ theo bảng giá set / giá lẻ
--     (khách không sửa được giá), chặn spam (tối đa 5 đơn / domain / 10 phút), cấp mã đơn HG + năm + ngày trong năm + 4 ký tự.
--   * Admin đọc / đổi trạng thái qua RLS; bảng nằm trong supabase_realtime để app nhận thông báo đơn mới ngay.
-- =============================================================================

alter table public.stores add column if not exists public_floors text[];

create table if not exists public.preorders (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores (id) on delete cascade,
  code             text not null,
  customer_name    text not null check (char_length(btrim(customer_name)) between 1 and 60),
  customer_domain  text not null check (customer_domain ~ '^[a-z0-9._-]{2,40}$'),
  floor            text not null check (floor ~ '^[A-Z0-9]{1,4}$'),
  payment          text not null check (payment in ('transfer', 'cash')),
  lines            jsonb not null check (jsonb_typeof(lines) = 'array'),
  total            numeric(12,2) not null check (total > 0),
  status           text not null default 'new' check (status in ('new', 'confirmed', 'paid', 'delivered', 'cancelled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint preorders_code_unique unique (store_id, code)
);
create index if not exists preorders_store_created_idx on public.preorders (store_id, created_at desc);
create index if not exists preorders_store_domain_idx on public.preorders (store_id, customer_domain, created_at desc);

alter table public.preorders enable row level security;
revoke all on table public.preorders from public, anon;
grant select, update, delete on public.preorders to authenticated;

drop policy if exists preorders_select_admin on public.preorders;
create policy preorders_select_admin on public.preorders for select to authenticated using ((select public.is_admin()));

drop policy if exists preorders_update_admin on public.preorders;
create policy preorders_update_admin on public.preorders for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists preorders_delete_admin on public.preorders;
create policy preorders_delete_admin on public.preorders for delete to authenticated using ((select public.is_admin()));

create or replace function public.preorders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists preorders_touch on public.preorders;
create trigger preorders_touch before update on public.preorders for each row execute function public.preorders_touch();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'preorders'
  ) then
    alter publication supabase_realtime add table public.preorders;
  end if;
end $$;

-- p_order: { name, domain, floor, payment, lines: [ { kind: 'set', size, mix: { <product_id>: số hũ }, qty } | { kind: 'single', product_id, qty } ] }
-- Trả về { code, total, lines } (lines đã tính giá trên máy chủ)
create or replace function public.submit_preorder(p_store_code text, p_order jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store     record;
  v_today     date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_name      text := btrim(coalesce(p_order ->> 'name', ''));
  v_domain    text := lower(regexp_replace(btrim(coalesce(p_order ->> 'domain', '')), '@.*$', ''));
  v_floor     text := upper(btrim(regexp_replace(btrim(coalesce(p_order ->> 'floor', '')), '^(f|tầng|tang|lầu|lau)\s*', '', 'i')));
  v_payment   text := coalesce(p_order ->> 'payment', 'transfer');
  v_line      jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_total     numeric := 0;
  v_qty       integer;
  v_size      integer;
  v_unit      numeric;
  v_pid       uuid;
  v_prod      record;
  v_entry     record;
  v_count     integer;
  v_jars      integer;
  v_category  text;
  v_line_size integer;
  v_sum       numeric;
  v_detail    text;
  v_code      text;
  v_alphabet  text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_try       integer := 0;
begin
  select s.id, s.code, s.public_floors into v_store from public.stores s
  where s.code = lower(btrim(coalesce(p_store_code, ''))) and s.is_public;
  if not found then
    raise exception 'Không tìm thấy cửa hàng';
  end if;

  if char_length(v_name) not between 1 and 60 then raise exception 'Nhập tên của bạn'; end if;
  if v_domain !~ '^[a-z0-9._-]{2,40}$' then raise exception 'Domain chưa đúng (vd: huong.vu3)'; end if;
  if v_floor !~ '^[A-Z0-9]{1,4}$' or (v_store.public_floors is not null and not (v_floor = any (v_store.public_floors))) then
    raise exception 'Tầng chưa đúng, chỉ giao tầng %', array_to_string(coalesce(v_store.public_floors, '{}'), ', ');
  end if;
  if v_payment not in ('transfer', 'cash') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  if jsonb_typeof(p_order -> 'lines') <> 'array' or jsonb_array_length(p_order -> 'lines') not between 1 and 30 then
    raise exception 'Đơn chưa có món nào';
  end if;

  select count(*) into v_count from public.preorders p
  where p.store_id = v_store.id and p.customer_domain = v_domain and p.created_at > now() - interval '10 minutes';
  if v_count >= 5 then raise exception 'Bạn vừa đặt nhiều đơn liên tiếp, thử lại sau ít phút nhé'; end if;

  for v_line in select e.value from jsonb_array_elements(p_order -> 'lines') as e(value) loop
    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty not between 1 and 99 then raise exception 'Số lượng không hợp lệ'; end if;

    if v_line ->> 'kind' = 'single' then
      v_pid := (v_line ->> 'product_id')::uuid;
      select p.id, p.name, (select pp.sale_price from public.product_prices pp
                             where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
                             order by pp.effective_from desc limit 1) as price
      into v_prod from public.products p
      where p.id = v_pid and p.store_id = v_store.id and p.is_active and p.public_sale_mode = 'single';
      if not found or v_prod.price is null then raise exception 'Món không còn bán lẻ'; end if;
      v_unit := v_prod.price;
      v_out := v_out || jsonb_build_object('kind', 'single', 'product_id', v_prod.id, 'title', v_prod.name, 'detail', 'Bán lẻ', 'qty', v_qty, 'unit_price', v_unit);

    elsif v_line ->> 'kind' = 'set' then
      v_size := (v_line ->> 'size')::integer;
      if v_size not in (4, 6) or jsonb_typeof(v_line -> 'mix') <> 'object' then raise exception 'Set không hợp lệ'; end if;
      v_jars := 0; v_sum := 0; v_count := 0; v_category := null; v_detail := '';
      for v_entry in
        select (e.key)::uuid as pid, (e.value)::integer as n, p.name, p.category,
               (select pp.sale_price from public.product_prices pp
                 where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
                 order by pp.effective_from desc limit 1) as price
        from jsonb_each_text(v_line -> 'mix') as e
        left join public.products p on p.id = (e.key)::uuid and p.store_id = v_store.id and p.is_active and p.public_sale_mode = 'set'
        where (e.value)::integer > 0
        order by p.name
      loop
        if v_entry.name is null then raise exception 'Vị trong set không còn bán'; end if;
        if v_category is not null and v_entry.category is distinct from v_category then raise exception 'Một set chỉ gồm các vị cùng loại'; end if;
        v_category := v_entry.category;
        v_jars := v_jars + v_entry.n;
        v_count := v_count + 1;
        v_pid := v_entry.pid;
        v_sum := case when v_sum is null or v_entry.price is null then null else v_sum + v_entry.n * v_entry.price end;
        v_detail := v_detail || case when v_detail = '' then '' else ' + ' end || v_entry.n || ' ' || v_entry.name;
      end loop;
      if v_jars <> v_size then raise exception 'Set % hũ phải chọn đủ % hũ', v_size, v_size; end if;

      -- Giá set: giá riêng cho set một vị -> giá mix của dòng món có >= 2 vị -> cộng giá từng hũ
      v_unit := null;
      if v_count = 1 then
        select r.price into v_unit from public.storefront_set_prices r where r.store_id = v_store.id and r.set_size = v_size and r.product_id = v_pid;
      end if;
      if v_unit is null then
        select count(*) into v_line_size from public.products p
        where p.store_id = v_store.id and p.is_active and p.public_sale_mode = 'set' and p.category is not distinct from v_category;
        if v_line_size >= 2 then
          select r.price into v_unit from public.storefront_set_prices r where r.store_id = v_store.id and r.set_size = v_size and r.product_id is null;
        end if;
      end if;
      v_unit := coalesce(v_unit, v_sum);
      if v_unit is null then raise exception 'Set chưa có giá'; end if;
      v_out := v_out || jsonb_build_object('kind', 'set', 'size', v_size, 'mix', v_line -> 'mix', 'title', 'Set ' || v_size || ' hũ', 'detail', v_detail, 'qty', v_qty, 'unit_price', v_unit);
    else
      raise exception 'Loại món không hợp lệ';
    end if;
    v_total := v_total + v_unit * v_qty;
  end loop;

  loop
    v_try := v_try + 1;
    v_code := case when v_store.code = 'hogi' then 'HG' else upper(left(v_store.code, 2)) end
              || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YY')
              || lpad(extract(doy from (now() at time zone 'Asia/Ho_Chi_Minh'))::text, 3, '0')
              || (select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from public.preorders p where p.store_id = v_store.id and p.code = v_code) or v_try >= 8;
  end loop;

  insert into public.preorders (store_id, code, customer_name, customer_domain, floor, payment, lines, total)
  values (v_store.id, v_code, v_name, v_domain, v_floor, v_payment, v_out, v_total);

  return jsonb_build_object('code', v_code, 'total', v_total, 'lines', v_out);
end;
$$;
revoke execute on function public.submit_preorder(text, jsonb) from public;
grant execute on function public.submit_preorder(text, jsonb) to anon, authenticated;
