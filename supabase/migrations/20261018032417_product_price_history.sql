-- =============================================================================
-- product_price_history — Lịch sử giá bán, giá ShopeeFood và giá vốn theo ngày áp dụng.
-- Giá có hiệu lực vào ngày D = dòng có effective_from <= D lớn nhất.
-- Đơn bán / đợt nhập đã ghi giữ nguyên giá đã chụp (sale_items, sale_item_cost_lines, stock_batches).
-- =============================================================================


-- =============================================================================
-- 1. BẢNG product_prices
-- =============================================================================

create table public.product_prices (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products (id) on delete cascade,
  effective_from  date not null,
  sale_price      numeric(14,2) not null check (sale_price >= 0),
  app_price       numeric(14,2) check (app_price >= 0),
  -- null = chưa có giá vốn: bán món không đếm tồn / nhập hàng bỏ trống giá sẽ báo lỗi
  unit_cost       numeric(14,2) check (unit_cost >= 0),
  note            text,
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (product_id, effective_from)
);
-- Ràng buộc unique (product_id, effective_from) đã là chỉ mục B-tree, quét ngược được
-- cho "dòng mới nhất <= ngày D", nên không tạo thêm chỉ mục (product_id, effective_from desc).
create index product_prices_created_by_idx on public.product_prices (created_by);

-- Có giá vốn nên chỉ admin. Nhân viên lấy giá bán qua get_store_prices.
revoke all on table public.product_prices from public, anon, authenticated;
grant select, insert, update, delete on public.product_prices to authenticated;

alter table public.product_prices enable row level security;

create policy product_prices_select_admin on public.product_prices
  for select to authenticated
  using ((select public.is_admin()));

create policy product_prices_insert_admin on public.product_prices
  for insert to authenticated
  with check ((select public.is_admin()));

create policy product_prices_update_admin on public.product_prices
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy product_prices_delete_admin on public.product_prices
  for delete to authenticated
  using ((select public.is_admin()));


-- =============================================================================
-- 2. CHUYỂN DỮ LIỆU GIÁ HIỆN TẠI SANG LỊCH SỬ
-- =============================================================================

-- Đơn bán cũ chụp giá từ products / product_fixed_costs. Chỉ xoá cột cũ khi chưa có đơn nào.
do $$
begin
  if exists (select 1 from public.sales) then
    raise exception 'Bảng sales đã có dữ liệu, dừng migration để kiểm tra lại';
  end if;
end;
$$;

insert into public.product_prices (product_id, effective_from, sale_price, app_price, unit_cost, note, created_by)
select
  p.id,
  date '2026-01-01',
  p.sale_price,
  p.app_price,
  fc.unit_cost,
  case when fc.unit_cost is null then 'Giá ban đầu – chưa có giá vốn' else 'Giá ban đầu' end,
  null
from public.products p
left join public.product_fixed_costs fc on fc.product_id = p.id;

alter table public.products drop column sale_price;
alter table public.products drop column app_price;
-- Policy và grant của bảng bị xoá theo bảng
drop table public.product_fixed_costs;


-- =============================================================================
-- 3. HÀM GIÁ
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_store_prices: giá bán / giá ShopeeFood có hiệu lực vào p_date (null = hôm nay).
-- Cho admin và thành viên cửa hàng. KHÔNG trả giá vốn.
-- -----------------------------------------------------------------------------
create or replace function public.get_store_prices(p_store_id uuid, p_date date)
returns table (
  product_id      uuid,
  sale_price      numeric,
  app_price       numeric,
  effective_from  date
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
  select distinct on (pp.product_id)
    pp.product_id,
    pp.sale_price,
    pp.app_price,
    pp.effective_from
  from public.product_prices pp
  join public.products p on p.id = pp.product_id
  where p.store_id = p_store_id
    and pp.effective_from <= coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date)
  order by pp.product_id, pp.effective_from desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- set_product_price: thêm / sửa giá theo (sản phẩm, ngày áp dụng). Chỉ admin.
-- SECURITY INVOKER: ghi qua RLS của product_prices (chỉ admin).
-- -----------------------------------------------------------------------------
create or replace function public.set_product_price(
  p_product_id      uuid,
  p_effective_from  date,
  p_sale_price      numeric,
  p_app_price       numeric,
  p_unit_cost       numeric,
  p_note            text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id  uuid;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được đổi giá' using errcode = '42501';
  end if;
  if p_effective_from is null then
    raise exception 'Thiếu ngày áp dụng';
  end if;
  if p_sale_price is null or p_sale_price < 0 then
    raise exception 'Giá bán không hợp lệ';
  end if;
  if p_app_price is not null and p_app_price < 0 then
    raise exception 'Giá ShopeeFood không hợp lệ';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Giá vốn không hợp lệ';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'Không tìm thấy sản phẩm %', p_product_id;
  end if;

  insert into public.product_prices (product_id, effective_from, sale_price, app_price, unit_cost, note)
  values (p_product_id, p_effective_from, p_sale_price, p_app_price, p_unit_cost, p_note)
  on conflict (product_id, effective_from) do update
  set sale_price = excluded.sale_price,
      app_price  = excluded.app_price,
      unit_cost  = excluded.unit_cost,
      note       = excluded.note,
      created_by = auth.uid(),
      created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.get_store_prices(uuid, date) from public, anon;
revoke execute on function public.set_product_price(uuid, date, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.get_store_prices(uuid, date) to authenticated;
grant execute on function public.set_product_price(uuid, date, numeric, numeric, numeric, text) to authenticated;


-- =============================================================================
-- 4. HÀM NGHIỆP VỤ ĐỌC GIÁ TỪ LỊCH SỬ
-- Chữ ký không đổi nên create or replace giữ nguyên grant cũ.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_purchase: tạo đợt nhập, mỗi dòng thành một lô ở nhà (qty_home).
--   unit_cost = null: lấy giá vốn có hiệu lực vào ngày nhập (product_prices).
-- p_items: [{ "product_id": uuid, "quantity": int, "unit_cost": number | null }]
-- -----------------------------------------------------------------------------
create or replace function public.create_purchase(
  p_store_id       uuid,
  p_purchase_date  date,
  p_note           text,
  p_items          jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date         date := coalesce(p_purchase_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_item         jsonb;
  v_product_id   uuid;
  v_qty          integer;
  v_unit_cost    numeric;
  v_product      record;
  v_purchase_id  uuid;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Đợt nhập phải có ít nhất một sản phẩm';
  end if;

  -- Kiểm tra toàn bộ dòng trước khi ghi
  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty        := (v_item ->> 'quantity')::integer;
    v_unit_cost  := (v_item ->> 'unit_cost')::numeric;

    if v_product_id is null then
      raise exception 'Thiếu mã sản phẩm trong đợt nhập';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Số lượng nhập phải lớn hơn 0';
    end if;
    if v_unit_cost is not null and v_unit_cost < 0 then
      raise exception 'Giá nhập không hợp lệ';
    end if;

    select p.name, p.tracks_stock into v_product
    from public.products p
    where p.id = v_product_id and p.store_id = p_store_id;

    if not found then
      raise exception 'Sản phẩm % không thuộc cửa hàng này', v_product_id;
    end if;
    if not v_product.tracks_stock then
      raise exception 'Sản phẩm "%" không quản lý tồn kho, không thể nhập hàng', v_product.name;
    end if;
    -- Bỏ trống giá nhập: dùng giá vốn của dòng giá có hiệu lực vào ngày nhập
    if v_unit_cost is null then
      select pp.unit_cost into v_unit_cost
      from public.product_prices pp
      where pp.product_id = v_product_id and pp.effective_from <= v_date
      order by pp.effective_from desc
      limit 1;
      if not found then
        raise exception 'Món "%" chưa có giá vào ngày %', v_product.name, v_date;
      end if;
      if v_unit_cost is null then
        raise exception 'Món "%" chưa có giá vốn vào ngày %, nhập giá hoặc nhờ admin cập nhật', v_product.name, v_date;
      end if;
    end if;
  end loop;

  insert into public.purchases (store_id, purchase_date, note, created_by)
  values (p_store_id, v_date, p_note, auth.uid())
  returning id into v_purchase_id;

  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_unit_cost  := (v_item ->> 'unit_cost')::numeric;
    if v_unit_cost is null then
      select pp.unit_cost into v_unit_cost
      from public.product_prices pp
      where pp.product_id = v_product_id and pp.effective_from <= v_date
      order by pp.effective_from desc
      limit 1;
    end if;

    insert into public.stock_batches (
      purchase_id, store_id, product_id, received_date,
      initial_qty, unit_cost, qty_home, qty_shop
    )
    values (
      v_purchase_id,
      p_store_id,
      v_product_id,
      v_date,
      (v_item ->> 'quantity')::integer,
      v_unit_cost,
      (v_item ->> 'quantity')::integer,
      0
    );
  end loop;

  return v_purchase_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_sale: tạo đơn bán trong một giao dịch.
--   * Món có tồn kho: trừ qty_shop theo FIFO, ghi một dòng giá vốn cho mỗi lô.
--   * Món không tồn kho: lấy giá vốn có hiệu lực vào ngày bán (product_prices), batch_id = null.
--   * Hoa hồng: 0 với in_store; shopeefood dùng p_commission_rate hoặc mặc định của cửa hàng.
-- p_items: [{ "product_id": uuid, "quantity": int, "unit_price": number }]
-- -----------------------------------------------------------------------------
create or replace function public.create_sale(
  p_store_id         uuid,
  p_sale_date        date,
  p_channel          text,
  p_note             text,
  p_items            jsonb,
  p_commission_rate  numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date             date := coalesce(p_sale_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_item             jsonb;
  v_product_id       uuid;
  v_qty              integer;
  v_unit_price       numeric;
  v_product          record;
  v_fixed_cost       numeric;
  v_commission_rate  numeric;
  v_total            numeric := 0;
  v_sale_id          uuid;
  v_sale_item_id     uuid;
  v_remaining        integer;
  v_take             integer;
  v_batch            record;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;

  if p_channel is null or p_channel not in ('in_store', 'shopeefood') then
    raise exception 'Kênh bán không hợp lệ: % (chỉ nhận in_store hoặc shopeefood)', p_channel;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Đơn bán phải có ít nhất một món';
  end if;

  -- Kiểm tra toàn bộ dòng trước khi ghi
  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty        := (v_item ->> 'quantity')::integer;
    v_unit_price := round((v_item ->> 'unit_price')::numeric, 2);

    if v_product_id is null then
      raise exception 'Thiếu mã sản phẩm trong đơn bán';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Số lượng bán phải lớn hơn 0';
    end if;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'Đơn giá bán không hợp lệ';
    end if;

    select p.name, p.tracks_stock into v_product
    from public.products p
    where p.id = v_product_id and p.store_id = p_store_id;

    if not found then
      raise exception 'Sản phẩm % không thuộc cửa hàng này', v_product_id;
    end if;

    if not v_product.tracks_stock then
      select pp.unit_cost into v_fixed_cost
      from public.product_prices pp
      where pp.product_id = v_product_id and pp.effective_from <= v_date
      order by pp.effective_from desc
      limit 1;
      if not found then
        raise exception 'Món "%" chưa có giá vào ngày %', v_product.name, v_date;
      end if;
      if v_fixed_cost is null then
        raise exception 'Món "%" chưa có giá vốn vào ngày %, cần admin nhập trước khi bán', v_product.name, v_date;
      end if;
    end if;

    v_total := v_total + v_qty * v_unit_price;
  end loop;

  -- Tỷ lệ hoa hồng
  if p_channel = 'in_store' then
    v_commission_rate := 0;
  else
    if p_commission_rate is not null then
      v_commission_rate := p_commission_rate;
    else
      select s.default_commission_rate into v_commission_rate
      from public.stores s
      where s.id = p_store_id;
    end if;

    if v_commission_rate is null or v_commission_rate < 0 or v_commission_rate > 1 then
      raise exception 'Tỷ lệ hoa hồng không hợp lệ (phải từ 0 đến 1)';
    end if;
  end if;

  -- Khoá trước mọi lô cần dùng theo thứ tự cố định (sản phẩm, ngày nhận, id)
  -- để hai đơn bán chạy song song không bị deadlock.
  perform 1
  from public.stock_batches b
  where b.store_id = p_store_id
    and b.qty_shop > 0
    and b.product_id in (
      select (e.value ->> 'product_id')::uuid
      from jsonb_array_elements(p_items) as e(value)
    )
  order by b.product_id, b.received_date, b.id
  for update;

  insert into public.sales (store_id, sale_date, channel, commission_rate, total_amount, note, created_by)
  values (p_store_id, v_date, p_channel, v_commission_rate, v_total, p_note, auth.uid())
  returning id into v_sale_id;

  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty        := (v_item ->> 'quantity')::integer;
    v_unit_price := round((v_item ->> 'unit_price')::numeric, 2);

    select p.name, p.tracks_stock into v_product
    from public.products p
    where p.id = v_product_id;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price)
    values (v_sale_id, v_product_id, v_qty, v_unit_price)
    returning id into v_sale_item_id;

    if v_product.tracks_stock then
      v_remaining := v_qty;

      for v_batch in
        select b.id, b.qty_shop, b.unit_cost
        from public.stock_batches b
        where b.store_id = p_store_id
          and b.product_id = v_product_id
          and b.qty_shop > 0
        order by b.received_date, b.id
        for update
      loop
        exit when v_remaining = 0;
        v_take := least(v_batch.qty_shop, v_remaining);

        update public.stock_batches
        set qty_shop = qty_shop - v_take
        where id = v_batch.id;

        insert into public.sale_item_cost_lines (sale_item_id, batch_id, quantity, unit_cost)
        values (v_sale_item_id, v_batch.id, v_take, v_batch.unit_cost);

        v_remaining := v_remaining - v_take;
      end loop;

      if v_remaining > 0 then
        raise exception 'Không đủ hàng ở quầy cho "%": hiện có %, cần bán %',
          v_product.name, v_qty - v_remaining, v_qty;
      end if;
    else
      select pp.unit_cost into v_fixed_cost
      from public.product_prices pp
      where pp.product_id = v_product_id and pp.effective_from <= v_date
      order by pp.effective_from desc
      limit 1;

      insert into public.sale_item_cost_lines (sale_item_id, batch_id, quantity, unit_cost)
      values (v_sale_item_id, null, v_qty, v_fixed_cost);
    end if;
  end loop;

  return v_sale_id;
end;
$$;
