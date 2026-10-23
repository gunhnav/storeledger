-- =============================================================================
-- Chuyển hàng từ Quán về Nhà (ví dụ lấy hũ từ quán lên công ty bán: chuyển về nhà rồi phân phối cho công ty).
--   * stock_transfers.destination nhận thêm 'home' (nơi nhận = nhà, nguồn = quán).
--   * create_shop_return: trừ qty_shop, cộng qty_home; lấy từ lô MỚI NHẤT trước để lô cũ ở lại quán bán trước (FIFO).
--   * get_daily_product_log: số chuyển ra / tồn quán / tồn nhà tính cả các lần chuyển về.
-- =============================================================================

alter table public.stock_transfers drop constraint stock_transfers_destination_check;
alter table public.stock_transfers
  add constraint stock_transfers_destination_check check (destination in ('shop', 'company', 'home'));
comment on column public.stock_transfers.destination is 'Nơi nhận: shop (quán), company (công ty) hoặc home (chuyển lại từ quán về nhà)';

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
  if v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được ghi ngày trong tương lai (%)', v_date;
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
    raise exception 'Không đủ hàng ở quán cho "%": hiện có %, cần chuyển về nhà %',
      v_product.name, p_quantity - v_remaining, p_quantity;
  end if;

  insert into public.stock_transfers (store_id, product_id, quantity, transfer_date, note, destination, created_by)
  values (p_store_id, p_product_id, p_quantity, v_date, p_note, 'home', auth.uid())
  returning id into v_transfer_id;
  return v_transfer_id;
end;
$$;

revoke execute on function public.create_shop_return(uuid, uuid, integer, date, text) from public, anon;
grant execute on function public.create_shop_return(uuid, uuid, integer, date, text) to authenticated;

create or replace function public.get_daily_product_log(
  p_store_id  uuid,
  p_from      date,
  p_to        date
)
returns table (
  day                  date,
  product_id           uuid,
  product_name         text,
  category             text,
  tracks_stock         boolean,
  qty_transferred      integer,
  qty_sold             integer,
  gross_revenue        numeric,
  cogs                 numeric,
  shop_end             integer,
  home_end             integer,
  low_stock_threshold  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_start  date;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem nhật ký ngày' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Khoảng ngày không hợp lệ';
  end if;
  if p_to - p_from > 365 then
    raise exception 'Khoảng ngày tối đa 366 ngày';
  end if;

  -- Tồn cuối ngày cộng dồn từ lô nhập đầu tiên, không chỉ trong khoảng đang xem
  select least(p_from, coalesce(min(b.received_date), p_from))
  into v_start
  from public.stock_batches b
  where b.store_id = p_store_id;

  return query
  with days as (
    select gs::date as d
    from generate_series(v_start, p_to, interval '1 day') as gs
  ),
  pur as (
    select b.product_id as pid, b.received_date as d, sum(b.initial_qty) as q
    from public.stock_batches b
    where b.store_id = p_store_id and b.received_date <= p_to
    group by 1, 2
  ),
  tr as (
    -- Chuyển về nhà (destination = 'home') trừ ra khỏi số đã mang khỏi nhà và số ra quán
    select t.product_id as pid, t.transfer_date as d,
           sum(case when t.destination = 'home' then -t.quantity else t.quantity end) as q,
           sum(case t.destination when 'shop' then t.quantity when 'home' then -t.quantity else 0 end) as q_shop
    from public.stock_transfers t
    where t.store_id = p_store_id and t.transfer_date <= p_to
    group by 1, 2
  ),
  sold as (
    select si.product_id as pid, s.sale_date as d,
           sum(si.quantity) as q,
           sum(si.quantity) filter (where s.channel <> 'company') as q_shop,
           sum(si.quantity * si.unit_price) as rev
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    where s.store_id = p_store_id and s.sale_date <= p_to
    group by 1, 2
  ),
  cg as (
    select si.product_id as pid, s.sale_date as d, sum(cl.quantity * cl.unit_cost) as amt
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    join public.sale_item_cost_lines cl on cl.sale_item_id = si.id
    where s.store_id = p_store_id and s.sale_date between p_from and p_to
    group by 1, 2
  ),
  stocked as (
    select
      days.d,
      p.id, p.name, p.category, p.low_stock_threshold,
      coalesce(pur.q, 0) as pur_q,
      coalesce(tr.q, 0) as tr_q,
      coalesce(tr.q_shop, 0) as tr_shop_q,
      coalesce(sold.q, 0) as sold_q,
      coalesce(sold.q_shop, 0) as sold_shop_q,
      coalesce(sold.rev, 0) as rev,
      coalesce(cg.amt, 0) as cogs_amt
    from public.products p
    cross join days
    left join pur  on pur.pid  = p.id and pur.d  = days.d
    left join tr   on tr.pid   = p.id and tr.d   = days.d
    left join sold on sold.pid = p.id and sold.d = days.d
    left join cg   on cg.pid   = p.id and cg.d   = days.d
    where p.store_id = p_store_id and p.tracks_stock
  ),
  stocked_cum as (
    select
      s.*,
      sum(s.pur_q - s.tr_q) over w as home_q,
      sum(s.tr_shop_q - s.sold_shop_q) over w as shop_q
    from stocked s
    window w as (partition by s.id order by s.d rows between unbounded preceding and current row)
  )
  select
    c.d, c.id, c.name, c.category, true,
    c.tr_q::integer, c.sold_q::integer, c.rev, c.cogs_amt,
    c.shop_q::integer, c.home_q::integer, c.low_stock_threshold
  from stocked_cum c
  where c.d between p_from and p_to

  union all

  select
    sold.d, p.id, p.name, p.category, false,
    0, sold.q::integer, sold.rev, coalesce(cg.amt, 0),
    null::integer, null::integer, p.low_stock_threshold
  from sold
  join public.products p on p.id = sold.pid
  left join cg on cg.pid = sold.pid and cg.d = sold.d
  where not p.tracks_stock and sold.d between p_from and p_to

  order by 1, 3;
end;
$$;
