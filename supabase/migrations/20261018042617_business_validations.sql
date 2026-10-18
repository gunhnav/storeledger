-- =============================================================================
-- business_validations — Kiểm tra nghiệp vụ phía database (chặn cả khi gọi API trực tiếp).
--   * Không ghi giao dịch / chi phí ngày tương lai (giờ Việt Nam).
--   * Không nhập / chuyển / bán món đã ngừng bán.
--   * Số lượng tối đa 10.000, tiền tối đa 1 tỷ mỗi dòng (chặn gõ nhầm).
--   * Chuyển và bán chỉ lấy lô đã nhập trước hoặc trong ngày giao dịch,
--     nên không bán / chuyển được khi chưa nhập hàng (kể cả ghi lùi ngày).
--   * Chi phí phải > 0.
-- Hàm viết lại đầy đủ, chép thân từ bản mới nhất; chữ ký không đổi nên giữ nguyên grant.
-- =============================================================================


-- =============================================================================
-- 1. CHI PHÍ
-- =============================================================================

alter table public.expenses
  add constraint expenses_amount_range_check check (amount > 0 and amount <= 1000000000);

drop policy expenses_insert_admin on public.expenses;
create policy expenses_insert_admin on public.expenses
  for insert to authenticated
  with check (
    (select public.is_admin())
    and created_by = (select auth.uid())
    and expense_date <= (now() at time zone 'Asia/Ho_Chi_Minh')::date
  );


-- =============================================================================
-- 2. HÀM NGHIỆP VỤ
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

  if v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được ghi ngày trong tương lai (%)', v_date;
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
    if v_qty > 10000 then
      raise exception 'Số lượng nhập quá lớn (tối đa 10.000)';
    end if;
    if v_unit_cost is not null and (v_unit_cost < 0 or v_unit_cost > 1000000000) then
      raise exception 'Giá nhập không hợp lệ';
    end if;

    select p.name, p.tracks_stock, p.is_active into v_product
    from public.products p
    where p.id = v_product_id and p.store_id = p_store_id;

    if not found then
      raise exception 'Sản phẩm % không thuộc cửa hàng này', v_product_id;
    end if;
    if not v_product.is_active then
      raise exception 'Món "%" đã ngừng bán', v_product.name;
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
-- create_transfer: chuyển hàng từ nhà ra quầy, lấy lô cũ nhất trước (FIFO).
--   Chỉ lấy lô đã nhập trước hoặc trong ngày chuyển.
-- -----------------------------------------------------------------------------
create or replace function public.create_transfer(
  p_store_id       uuid,
  p_product_id     uuid,
  p_quantity       integer,
  p_transfer_date  date,
  p_note           text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date         date := coalesce(p_transfer_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_product      record;
  v_remaining    integer;
  v_take         integer;
  v_batch        record;
  v_transfer_id  uuid;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;

  if v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được ghi ngày trong tương lai (%)', v_date;
  end if;

  select p.name, p.tracks_stock, p.is_active into v_product
  from public.products p
  where p.id = p_product_id and p.store_id = p_store_id;

  if not found then
    raise exception 'Sản phẩm % không thuộc cửa hàng này', p_product_id;
  end if;
  if not v_product.is_active then
    raise exception 'Món "%" đã ngừng bán', v_product.name;
  end if;
  if not v_product.tracks_stock then
    raise exception 'Sản phẩm "%" không quản lý tồn kho, không thể chuyển hàng', v_product.name;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Số lượng chuyển phải lớn hơn 0';
  end if;
  if p_quantity > 10000 then
    raise exception 'Số lượng chuyển quá lớn (tối đa 10.000)';
  end if;

  v_remaining := p_quantity;

  for v_batch in
    select b.id, b.qty_home
    from public.stock_batches b
    where b.store_id = p_store_id
      and b.product_id = p_product_id
      and b.qty_home > 0
      and b.received_date <= v_date
    order by b.received_date, b.id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_batch.qty_home, v_remaining);

    update public.stock_batches
    set qty_home = qty_home - v_take,
        qty_shop = qty_shop + v_take
    where id = v_batch.id;

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Không đủ hàng ở nhà cho "%" tính đến ngày %: hiện có %, cần chuyển %. Nhập hàng trước',
      v_product.name, v_date, p_quantity - v_remaining, p_quantity;
  end if;

  insert into public.stock_transfers (store_id, product_id, quantity, transfer_date, note, created_by)
  values (p_store_id, p_product_id, p_quantity, v_date, p_note, auth.uid())
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_sale: tạo đơn bán trong một giao dịch.
--   * Món có tồn kho: trừ qty_shop theo FIFO (chỉ lô nhập trước hoặc trong ngày bán),
--     ghi một dòng giá vốn cho mỗi lô.
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

  if v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được ghi ngày trong tương lai (%)', v_date;
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
    if v_qty > 10000 then
      raise exception 'Số lượng bán quá lớn (tối đa 10.000)';
    end if;
    if v_unit_price is null or v_unit_price < 0 or v_unit_price > 1000000000 then
      raise exception 'Đơn giá bán không hợp lệ';
    end if;

    select p.name, p.tracks_stock, p.is_active into v_product
    from public.products p
    where p.id = v_product_id and p.store_id = p_store_id;

    if not found then
      raise exception 'Sản phẩm % không thuộc cửa hàng này', v_product_id;
    end if;
    if not v_product.is_active then
      raise exception 'Món "%" đã ngừng bán', v_product.name;
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
    and b.received_date <= v_date
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
          and b.received_date <= v_date
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
        raise exception 'Không đủ hàng ở quầy cho "%" tính đến ngày %: hiện có %, cần bán %. Nhập hàng và chuyển ra quầy trước khi bán',
          v_product.name, v_date, v_qty - v_remaining, v_qty;
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
