-- =============================================================================
-- Nguyên liệu + công thức món (quán Bún đậu) và báo cáo riêng cho quán.
--   * ingredients: nguyên liệu đếm theo miếng / phần / kg... (chả cốm, chả ốc, giò, nạm...), mỗi quán một danh sách.
--   * recipes: một phần món dùng bao nhiêu nguyên liệu (ví dụ "Bún đậu chả cốm" = 2 miếng chả cốm).
--   * ingredient_receipts: các lần nhập nguyên liệu (số lượng, tiền). Tồn = tổng nhập - Σ (số phần đã bán × định lượng).
--     Tồn kho nguyên liệu tính theo doanh thu, không có bước trừ riêng khi bán.
--   * Tiền nhập nguyên liệu ghi vào Chi phí bình thường (tính vào lãi lỗ khi nhập, đúng cách chủ quán đang ghi).
--     Món ăn có giá vốn 0 để bán được (giá vốn thật là chi phí nguyên liệu); đồ uống vẫn theo lô FIFO.
--   * get_ingredient_stock: tồn nguyên liệu (cả nhân viên xem được, chỉ số lượng).
--   * get_bundau_report: số liệu bán hàng theo ngày, kênh, món, giờ (chỉ admin).
-- =============================================================================

create table public.ingredients (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references public.stores (id),
  name                 text not null check (char_length(btrim(name)) between 1 and 80),
  unit                 text not null default 'miếng' check (char_length(btrim(unit)) between 1 and 20),
  low_stock_threshold  numeric(12,2) not null default 0 check (low_stock_threshold >= 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);
create unique index ingredients_store_name_idx on public.ingredients (store_id, lower(btrim(name)));

create table public.recipes (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients (id) on delete cascade,
  qty            numeric(10,3) not null check (qty > 0 and qty <= 1000),
  unique (product_id, ingredient_id)
);
create index recipes_ingredient_idx on public.recipes (ingredient_id);

create table public.ingredient_receipts (
  id             uuid primary key default gen_random_uuid(),
  ingredient_id  uuid not null references public.ingredients (id) on delete cascade,
  store_id       uuid not null references public.stores (id),
  receipt_date   date not null,
  quantity       numeric(12,2) not null check (quantity > 0 and quantity <= 1000000),
  amount         numeric(14,2) check (amount is null or amount >= 0),
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index ingredient_receipts_store_date_idx on public.ingredient_receipts (store_id, receipt_date);
create index ingredient_receipts_ingredient_idx on public.ingredient_receipts (ingredient_id);

alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.ingredient_receipts enable row level security;
revoke all on table public.ingredients, public.recipes, public.ingredient_receipts from public, anon;
grant select, insert, update, delete on public.ingredients to authenticated;
grant select, insert, update, delete on public.recipes to authenticated;
grant select on public.ingredient_receipts to authenticated;

create policy ingredients_select on public.ingredients
  for select to authenticated using ((select public.is_admin()) or public.is_store_member(store_id));
create policy ingredients_write_admin on public.ingredients
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy recipes_admin on public.recipes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy ingredient_receipts_select_admin on public.ingredient_receipts
  for select to authenticated using ((select public.is_admin()));

-- Nhập nguyên liệu: mỗi dòng một lần nhập; có tiền thì ghi luôn khoản chi (chỉ admin ghi được chi phí)
-- p_items: [{ "ingredient_id": uuid, "quantity": số, "amount": số | null, "category": "Nguyên liệu" }]
create or replace function public.receive_ingredients(p_store_id uuid, p_date date, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   jsonb;
  v_ing    record;
  v_qty    numeric;
  v_amount numeric;
  v_cat    text;
  v_count  integer := 0;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được ghi ngày trong tương lai (%)', p_date;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Chưa có nguyên liệu nào';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    v_qty := (v_item ->> 'quantity')::numeric;
    v_amount := nullif(v_item ->> 'amount', '')::numeric;
    v_cat := coalesce(nullif(v_item ->> 'category', ''), 'Nguyên liệu');
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
      raise exception 'Số lượng nguyên liệu phải lớn hơn 0';
    end if;
    select i.id, i.name into v_ing
    from public.ingredients i
    where i.id = (v_item ->> 'ingredient_id')::uuid and i.store_id = p_store_id and i.is_active;
    if not found then
      raise exception 'Nguyên liệu không thuộc cửa hàng này';
    end if;

    insert into public.ingredient_receipts (ingredient_id, store_id, receipt_date, quantity, amount, created_by)
    values (v_ing.id, p_store_id, p_date, v_qty, v_amount, auth.uid());

    if v_amount is not null and v_amount > 0 then
      if not public.is_admin() then
        raise exception 'Chỉ admin được ghi tiền nhập nguyên liệu vào Chi phí' using errcode = '42501';
      end if;
      if v_cat not in ('Đồ uống', 'Nguyên liệu', 'Dụng cụ', 'Quảng cáo', 'Khác') then
        raise exception 'Nhóm chi phí không hợp lệ';
      end if;
      insert into public.expenses (store_id, expense_date, category, amount, quantity, unit_price, note)
      values (p_store_id, p_date, v_cat, v_amount, v_qty, round(v_amount / v_qty, 2), v_ing.name);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Công thức một món: thay toàn bộ dòng. p_lines: [{ "ingredient_id": uuid, "qty": số }]
create or replace function public.set_recipe(p_product_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store uuid;
  v_line  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa công thức' using errcode = '42501';
  end if;
  select p.store_id into v_store from public.products p where p.id = p_product_id;
  if not found then
    raise exception 'Không tìm thấy món';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Công thức không hợp lệ';
  end if;

  delete from public.recipes where product_id = p_product_id;
  for v_line in select e.value from jsonb_array_elements(p_lines) as e(value) loop
    if not exists (select 1 from public.ingredients i where i.id = (v_line ->> 'ingredient_id')::uuid and i.store_id = v_store) then
      raise exception 'Nguyên liệu không thuộc cửa hàng của món này';
    end if;
    insert into public.recipes (product_id, ingredient_id, qty)
    values (p_product_id, (v_line ->> 'ingredient_id')::uuid, (v_line ->> 'qty')::numeric)
    on conflict (product_id, ingredient_id) do update set qty = excluded.qty;
  end loop;
end;
$$;

-- Tồn nguyên liệu = tổng nhập - Σ (số phần đã bán × định lượng). used_recent: lượng dùng trong p_recent_days ngày gần nhất.
create or replace function public.get_ingredient_stock(p_store_id uuid, p_recent_days integer default 7)
returns table (
  ingredient_id    uuid,
  name             text,
  unit             text,
  low_stock_threshold numeric,
  received         numeric,
  used             numeric,
  on_hand          numeric,
  used_recent      numeric,
  last_receipt     date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền xem cửa hàng này' using errcode = '42501';
  end if;

  return query
  select
    i.id, i.name, i.unit, i.low_stock_threshold,
    coalesce((select sum(r.quantity) from public.ingredient_receipts r where r.ingredient_id = i.id), 0)::numeric,
    coalesce((select sum(si.quantity * rc.qty)
              from public.recipes rc
              join public.sale_items si on si.product_id = rc.product_id
              join public.sales s on s.id = si.sale_id
              where rc.ingredient_id = i.id and s.store_id = p_store_id), 0)::numeric,
    (coalesce((select sum(r.quantity) from public.ingredient_receipts r where r.ingredient_id = i.id), 0)
     - coalesce((select sum(si.quantity * rc.qty)
                 from public.recipes rc
                 join public.sale_items si on si.product_id = rc.product_id
                 join public.sales s on s.id = si.sale_id
                 where rc.ingredient_id = i.id and s.store_id = p_store_id), 0))::numeric,
    coalesce((select sum(si.quantity * rc.qty)
              from public.recipes rc
              join public.sale_items si on si.product_id = rc.product_id
              join public.sales s on s.id = si.sale_id
              where rc.ingredient_id = i.id and s.store_id = p_store_id
                and s.sale_date > v_today - greatest(coalesce(p_recent_days, 7), 1)), 0)::numeric,
    (select max(r.receipt_date) from public.ingredient_receipts r where r.ingredient_id = i.id)
  from public.ingredients i
  where i.store_id = p_store_id and i.is_active
  order by i.name;
end;
$$;

-- Số liệu bán hàng của quán trong khoảng ngày (chỉ admin): theo ngày, kênh, món, giờ trong ngày (giờ Việt Nam)
create or replace function public.get_bundau_report(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days     jsonb;
  v_channels jsonb;
  v_top      jsonb;
  v_hours    jsonb;
  v_totals   jsonb;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem báo cáo' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'Khoảng ngày không hợp lệ';
  end if;

  select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb) into v_days from (
    select s.sale_date as day, count(*) as orders, sum(s.total_amount) as gross,
           sum(round(s.total_amount * s.commission_rate, 2)) as commission,
           sum(s.discount_amount) as discount
    from public.sales s
    where s.store_id = p_store_id and s.sale_date between p_from and p_to
    group by 1
  ) d;

  select coalesce(jsonb_agg(c), '[]'::jsonb) into v_channels from (
    select s.channel, count(*) as orders, sum(s.total_amount) as gross,
           sum(round(s.total_amount * s.commission_rate, 2)) as commission
    from public.sales s
    where s.store_id = p_store_id and s.sale_date between p_from and p_to
    group by 1
  ) c;

  select coalesce(jsonb_agg(t order by t.qty desc, t.revenue desc), '[]'::jsonb) into v_top from (
    select p.name, sum(si.quantity) as qty, sum(si.quantity * si.unit_price) as revenue
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    join public.products p on p.id = si.product_id
    where s.store_id = p_store_id and s.sale_date between p_from and p_to
    group by p.name
    order by qty desc, revenue desc
    limit 15
  ) t;

  select coalesce(jsonb_agg(h order by h.hour), '[]'::jsonb) into v_hours from (
    select extract(hour from (s.created_at at time zone 'Asia/Ho_Chi_Minh'))::int as hour, count(*) as orders,
           sum(s.total_amount) as gross
    from public.sales s
    where s.store_id = p_store_id and s.sale_date between p_from and p_to
    group by 1
  ) h;

  select jsonb_build_object(
    'orders', count(*), 'gross', coalesce(sum(s.total_amount), 0),
    'commission', coalesce(sum(round(s.total_amount * s.commission_rate, 2)), 0),
    'discount', coalesce(sum(s.discount_amount), 0),
    'portions', coalesce((select sum(si.quantity) from public.sale_items si join public.sales s2 on s2.id = si.sale_id
                          where s2.store_id = p_store_id and s2.sale_date between p_from and p_to), 0)
  ) into v_totals
  from public.sales s
  where s.store_id = p_store_id and s.sale_date between p_from and p_to;

  return jsonb_build_object('totals', v_totals, 'days', v_days, 'channels', v_channels, 'top', v_top, 'hours', v_hours);
end;
$$;

revoke execute on function public.receive_ingredients(uuid, date, jsonb) from public, anon;
grant execute on function public.receive_ingredients(uuid, date, jsonb) to authenticated;
revoke execute on function public.set_recipe(uuid, jsonb) from public, anon;
grant execute on function public.set_recipe(uuid, jsonb) to authenticated;
revoke execute on function public.get_ingredient_stock(uuid, integer) from public, anon;
grant execute on function public.get_ingredient_stock(uuid, integer) to authenticated;
revoke execute on function public.get_bundau_report(uuid, date, date) from public, anon;
grant execute on function public.get_bundau_report(uuid, date, date) to authenticated;

-- Món ăn của Bún đậu chưa có giá vốn nên không bán được (create_sale đòi giá vốn): đặt 0, giá vốn thật là
-- tiền nguyên liệu ghi ở Chi phí. Chỉ điền chỗ còn trống, không đụng giá vốn đã đặt.
update public.product_prices pp
set unit_cost = 0
from public.products p
join public.stores s on s.id = p.store_id
where pp.product_id = p.id and s.code = 'bundau' and not p.tracks_stock and pp.unit_cost is null;
