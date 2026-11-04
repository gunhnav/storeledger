-- =============================================================================
-- 1) Hàng huỷ (không đủ chất lượng bán): ghi số hũ bỏ đi, trừ khỏi tồn kho theo nơi để.
--   * stock_disposals: mỗi lần huỷ một món ở một nơi (nhà / quán / công ty), kèm lý do.
--   * stock_disposal_lines: phần lấy ra từ từng lô, trừ lô CŨ NHẤT trước (hàng để lâu dễ hỏng nhất),
--     chụp giá vốn lô để báo cáo theo đợt nhập tính được giá trị hàng huỷ.
--   * create_stock_disposal: nhân viên của quán hoặc admin ghi; delete_stock_disposal: chỉ admin, trả hàng lại lô.
--   * get_daily_product_log: tồn nhà / tồn quán cuối ngày trừ cả hàng huỷ.
-- 2) Đợt nhập đã thanh toán chưa: purchases.paid_on (null = chưa thanh toán), đặt qua set_purchase_payment (admin).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 2) Thanh toán đợt nhập
-- ---------------------------------------------------------------------------
alter table public.purchases add column if not exists paid_on date;
comment on column public.purchases.paid_on is 'Ngày đã thanh toán tiền đợt nhập cho nhà cung cấp; null = chưa thanh toán';

create or replace function public.set_purchase_payment(
  p_purchase_id  uuid,
  p_paid_on      date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được cập nhật thanh toán đợt nhập' using errcode = '42501';
  end if;
  if p_paid_on is not null and p_paid_on > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được ghi ngày trong tương lai (%)', p_paid_on;
  end if;
  update public.purchases set paid_on = p_paid_on where id = p_purchase_id;
  if not found then
    raise exception 'Không tìm thấy đợt nhập';
  end if;
end;
$$;

revoke execute on function public.set_purchase_payment(uuid, date) from public, anon;
grant execute on function public.set_purchase_payment(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Hàng huỷ
-- ---------------------------------------------------------------------------
create table if not exists public.stock_disposals (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores (id),
  product_id     uuid not null references public.products (id),
  disposal_date  date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  location       text not null check (location in ('home', 'shop', 'company')),
  quantity       integer not null check (quantity > 0 and quantity <= 10000),
  reason         text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
comment on table public.stock_disposals is 'Hàng huỷ vì không đủ chất lượng bán; ghi / xoá qua create_stock_disposal, delete_stock_disposal';
comment on column public.stock_disposals.location is 'Nơi để hàng bị huỷ: home (nhà), shop (quán), company (công ty)';

create table if not exists public.stock_disposal_lines (
  id           uuid primary key default gen_random_uuid(),
  disposal_id  uuid not null references public.stock_disposals (id) on delete cascade,
  batch_id     uuid not null references public.stock_batches (id),
  quantity     integer not null check (quantity > 0),
  unit_cost    numeric(14, 2) not null check (unit_cost >= 0)
);
comment on table public.stock_disposal_lines is 'Phần hàng huỷ lấy từ từng lô (lô cũ trước), kèm giá vốn lô lúc huỷ';

create index if not exists stock_disposals_store_date_idx on public.stock_disposals (store_id, disposal_date);
create index if not exists stock_disposals_product_idx on public.stock_disposals (product_id);
create index if not exists stock_disposal_lines_disposal_idx on public.stock_disposal_lines (disposal_id);
create index if not exists stock_disposal_lines_batch_idx on public.stock_disposal_lines (batch_id);

alter table public.stock_disposals enable row level security;
alter table public.stock_disposal_lines enable row level security;

-- Nhân viên của quán xem được lịch sử huỷ (không có giá vốn); giá vốn từng lô chỉ admin xem
drop policy if exists stock_disposals_select on public.stock_disposals;
create policy stock_disposals_select on public.stock_disposals
  for select to authenticated
  using ((select public.is_admin()) or public.is_store_member(store_id));

drop policy if exists stock_disposal_lines_select_admin on public.stock_disposal_lines;
create policy stock_disposal_lines_select_admin on public.stock_disposal_lines
  for select to authenticated
  using ((select public.is_admin()));

create or replace function public.create_stock_disposal(
  p_store_id       uuid,
  p_product_id     uuid,
  p_location       text,
  p_quantity       integer,
  p_disposal_date  date,
  p_reason         text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date         date := coalesce(p_disposal_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_product      record;
  v_remaining    integer;
  v_take         integer;
  v_batch        record;
  v_disposal_id  uuid;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được ghi ngày trong tương lai (%)', v_date;
  end if;
  if p_location is null or p_location not in ('home', 'shop', 'company') then
    raise exception 'Nơi để hàng không hợp lệ';
  end if;

  select p.name, p.tracks_stock into v_product
  from public.products p
  where p.id = p_product_id and p.store_id = p_store_id;
  if not found then
    raise exception 'Sản phẩm % không thuộc cửa hàng này', p_product_id;
  end if;
  if not v_product.tracks_stock then
    raise exception 'Sản phẩm "%" không quản lý tồn kho, không thể ghi huỷ', v_product.name;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Số lượng huỷ phải lớn hơn 0';
  end if;
  if p_quantity > 10000 then
    raise exception 'Số lượng huỷ quá lớn (tối đa 10.000)';
  end if;

  insert into public.stock_disposals (store_id, product_id, disposal_date, location, quantity, reason, created_by)
  values (p_store_id, p_product_id, v_date, p_location, p_quantity, nullif(trim(p_reason), ''), auth.uid())
  returning id into v_disposal_id;

  v_remaining := p_quantity;
  for v_batch in
    select b.id, b.unit_cost,
           case p_location when 'home' then b.qty_home when 'shop' then b.qty_shop else b.qty_company end as avail
    from public.stock_batches b
    where b.store_id = p_store_id
      and b.product_id = p_product_id
      and case p_location when 'home' then b.qty_home when 'shop' then b.qty_shop else b.qty_company end > 0
    order by b.received_date, b.id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_batch.avail, v_remaining);
    update public.stock_batches
    set qty_home    = qty_home    - case when p_location = 'home'    then v_take else 0 end,
        qty_shop    = qty_shop    - case when p_location = 'shop'    then v_take else 0 end,
        qty_company = qty_company - case when p_location = 'company' then v_take else 0 end
    where id = v_batch.id;
    insert into public.stock_disposal_lines (disposal_id, batch_id, quantity, unit_cost)
    values (v_disposal_id, v_batch.id, v_take, v_batch.unit_cost);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Không đủ hàng để huỷ "%": hiện có %, cần huỷ %',
      v_product.name, p_quantity - v_remaining, p_quantity;
  end if;

  return v_disposal_id;
end;
$$;

revoke execute on function public.create_stock_disposal(uuid, uuid, text, integer, date, text) from public, anon;
grant execute on function public.create_stock_disposal(uuid, uuid, text, integer, date, text) to authenticated;

-- Xoá lần huỷ ghi nhầm: trả số hũ về đúng lô và đúng nơi để
create or replace function public.delete_stock_disposal(p_disposal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location  text;
  v_line      record;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xoá lần huỷ hàng' using errcode = '42501';
  end if;

  select d.location into v_location
  from public.stock_disposals d
  where d.id = p_disposal_id
  for update;
  if not found then
    raise exception 'Không tìm thấy lần huỷ hàng';
  end if;

  for v_line in
    select l.batch_id, l.quantity from public.stock_disposal_lines l where l.disposal_id = p_disposal_id
  loop
    update public.stock_batches
    set qty_home    = qty_home    + case when v_location = 'home'    then v_line.quantity else 0 end,
        qty_shop    = qty_shop    + case when v_location = 'shop'    then v_line.quantity else 0 end,
        qty_company = qty_company + case when v_location = 'company' then v_line.quantity else 0 end
    where id = v_line.batch_id;
  end loop;

  delete from public.stock_disposals where id = p_disposal_id;
end;
$$;

revoke execute on function public.delete_stock_disposal(uuid) from public, anon;
grant execute on function public.delete_stock_disposal(uuid) to authenticated;

-- Nhật ký ngày: tồn nhà / tồn quán cuối ngày trừ cả hàng huỷ ở nơi đó
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
  dsp as (
    select x.product_id as pid, x.disposal_date as d,
           sum(x.quantity) filter (where x.location = 'home') as q_home,
           sum(x.quantity) filter (where x.location = 'shop') as q_shop
    from public.stock_disposals x
    where x.store_id = p_store_id and x.disposal_date <= p_to
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
      coalesce(dsp.q_home, 0) as dsp_home_q,
      coalesce(dsp.q_shop, 0) as dsp_shop_q,
      coalesce(sold.rev, 0) as rev,
      coalesce(cg.amt, 0) as cogs_amt
    from public.products p
    cross join days
    left join pur  on pur.pid  = p.id and pur.d  = days.d
    left join tr   on tr.pid   = p.id and tr.d   = days.d
    left join sold on sold.pid = p.id and sold.d = days.d
    left join dsp  on dsp.pid  = p.id and dsp.d  = days.d
    left join cg   on cg.pid   = p.id and cg.d   = days.d
    where p.store_id = p_store_id and p.tracks_stock
  ),
  stocked_cum as (
    select
      s.*,
      sum(s.pur_q - s.tr_q - s.dsp_home_q) over w as home_q,
      sum(s.tr_shop_q - s.sold_shop_q - s.dsp_shop_q) over w as shop_q
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
