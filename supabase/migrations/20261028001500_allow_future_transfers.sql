-- =============================================================================
-- Cho phép phân phối hàng trong tương lai (ra quán, cho công ty, chuyển về nhà).
-- Bỏ chặn ngày tương lai trong create_transfer và create_shop_return.
-- =============================================================================

create or replace function public.create_transfer(
  p_store_id       uuid,
  p_product_id     uuid,
  p_quantity       integer,
  p_transfer_date  date,
  p_note           text,
  p_destination    text default 'shop'
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
  if p_destination is null or p_destination not in ('shop', 'company') then
    raise exception 'Nơi nhận không hợp lệ: % (chỉ nhận shop hoặc company)', p_destination;
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
    set qty_home    = qty_home - v_take,
        qty_shop    = qty_shop + case when p_destination = 'shop' then v_take else 0 end,
        qty_company = qty_company + case when p_destination = 'company' then v_take else 0 end
    where id = v_batch.id;

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Không đủ hàng ở nhà cho "%" tính đến ngày %: hiện có %, cần chuyển %. Nhập hàng trước',
      v_product.name, v_date, p_quantity - v_remaining, p_quantity;
  end if;

  insert into public.stock_transfers (store_id, product_id, quantity, transfer_date, note, destination, created_by)
  values (p_store_id, p_product_id, p_quantity, v_date, p_note, p_destination, auth.uid())
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;

create or replace function public.create_shop_return(
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

  select p.name, p.tracks_stock into v_product
  from public.products p
  where p.id = p_product_id and p.store_id = p_store_id;
  if not found then
    raise exception 'Sản phẩm % không thuộc cửa hàng này', p_product_id;
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
    select b.id, b.qty_shop
    from public.stock_batches b
    where b.store_id = p_store_id
      and b.product_id = p_product_id
      and b.qty_shop > 0
    order by b.received_date desc, b.id desc
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_batch.qty_shop, v_remaining);

    update public.stock_batches
    set qty_shop = qty_shop - v_take,
        qty_home = qty_home + v_take
    where id = v_batch.id;

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Không đủ hàng ở quán cho "%": hiện có %, cần chuyển về %. Chuyển hàng ra quán trước',
      v_product.name, p_quantity - v_remaining, p_quantity;
  end if;

  insert into public.stock_transfers (store_id, product_id, quantity, transfer_date, note, destination, created_by)
  values (p_store_id, p_product_id, p_quantity, v_date, p_note, 'home', auth.uid())
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;

revoke execute on function public.create_transfer(uuid, uuid, integer, date, text, text) from public, anon;
grant execute on function public.create_transfer(uuid, uuid, integer, date, text, text) to authenticated;

revoke execute on function public.create_shop_return(uuid, uuid, integer, date, text) from public, anon;
grant execute on function public.create_shop_return(uuid, uuid, integer, date, text) to authenticated;
