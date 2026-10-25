-- =============================================================================
-- Bảng giá SET của trang đặt trước công khai (thay hai cột public_set_price_4 / _6 chỉ có một giá chung).
--   * Mỗi dòng: cỡ set (4 hoặc 6 hũ), giá, và product_id:
--       - product_id có giá trị: giá của set CHỈ gồm vị đó (ví dụ set 4 toàn Truyền thống = 50.000đ);
--       - product_id null: giá mặc định cho set mix vị (và các set một vị không có dòng riêng) của dòng món có từ 2 vị trở lên.
--     Dòng món chỉ có một vị (ví dụ Bánh flan) hoặc không có dòng nào khớp thì giá set = tổng giá từng hũ.
--   * save_storefront_set_prices ghi lại cả bảng giá của quán trong một lần (chỉ admin).
--   * get_public_menu trả thêm set_prices: [{ size, product_id, price }].
-- =============================================================================

create table if not exists public.storefront_set_prices (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  set_size    integer not null check (set_size in (4, 6)),
  product_id  uuid references public.products (id) on delete cascade,
  price       numeric(12,2) not null check (price > 0 and price <= 100000000),
  created_at  timestamptz not null default now()
);
create unique index if not exists storefront_set_prices_unique
  on public.storefront_set_prices (store_id, set_size, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists storefront_set_prices_product_idx on public.storefront_set_prices (product_id);

alter table public.storefront_set_prices enable row level security;
revoke all on table public.storefront_set_prices from public, anon;
grant select, insert, update, delete on public.storefront_set_prices to authenticated;

drop policy if exists storefront_set_prices_admin on public.storefront_set_prices;
create policy storefront_set_prices_admin on public.storefront_set_prices
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- p_rules: [{ "size": 4, "product_id": "<uuid>" | null, "price": 50000 }, ...]
create or replace function public.save_storefront_set_prices(p_store_id uuid, p_rules jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_rule  jsonb;
  v_count integer := 0;
  v_pid   uuid;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa bảng giá set' using errcode = '42501';
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    raise exception 'Bảng giá set không hợp lệ';
  end if;

  delete from public.storefront_set_prices where store_id = p_store_id;
  for v_rule in select e.value from jsonb_array_elements(p_rules) as e(value) loop
    v_pid := nullif(v_rule ->> 'product_id', '')::uuid;
    if v_pid is not null and not exists (select 1 from public.products p where p.id = v_pid and p.store_id = p_store_id) then
      raise exception 'Sản phẩm không thuộc cửa hàng này';
    end if;
    insert into public.storefront_set_prices (store_id, set_size, product_id, price)
    values (p_store_id, (v_rule ->> 'size')::integer, v_pid, (v_rule ->> 'price')::numeric);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.save_storefront_set_prices(uuid, jsonb) from public, anon;
grant execute on function public.save_storefront_set_prices(uuid, jsonb) to authenticated;

alter table public.stores drop column public_set_price_4, drop column public_set_price_6;

create or replace function public.get_public_menu(p_store_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store  record;
  v_today  date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_items  jsonb;
  v_prices jsonb;
  v_bank   jsonb := null;
begin
  select s.id, s.name, s.public_phone, s.public_tagline,
         s.public_bank_code, s.public_bank_account, s.public_bank_holder into v_store
  from public.stores s
  where s.code = lower(btrim(coalesce(p_store_code, ''))) and s.is_public;
  if not found then
    return null;
  end if;

  if v_store.public_bank_code is not null and v_store.public_bank_account is not null and v_store.public_bank_holder is not null then
    v_bank := jsonb_build_object('code', v_store.public_bank_code, 'account', v_store.public_bank_account, 'holder', v_store.public_bank_holder);
  end if;

  select coalesce(jsonb_agg(i order by i.sort_group, i.name), '[]'::jsonb) into v_items
  from (
    select
      p.id,
      p.name,
      p.category,
      case when p.category is null then 1 else 0 end as sort_group,
      (select pp.sale_price from public.product_prices pp
        where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
        order by pp.effective_from desc limit 1) as price
    from public.products p
    where p.store_id = v_store.id and p.is_active
  ) i;

  select coalesce(jsonb_agg(jsonb_build_object('size', r.set_size, 'product_id', r.product_id, 'price', r.price) order by r.set_size, r.product_id nulls last), '[]'::jsonb)
  into v_prices
  from public.storefront_set_prices r
  where r.store_id = v_store.id;

  return jsonb_build_object(
    'store', jsonb_build_object('name', v_store.name, 'phone', v_store.public_phone, 'tagline', v_store.public_tagline, 'bank', v_bank, 'set_prices', v_prices),
    'items', v_items
  );
end;
$$;

revoke execute on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;
