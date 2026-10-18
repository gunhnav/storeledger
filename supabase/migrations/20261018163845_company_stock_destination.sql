-- =============================================================================
-- company_stock_destination — Chuyển kho có nơi nhận: Quầy hoặc Công ty.
--   * stock_batches.qty_company: hàng đã mang cho công ty, chưa bán (tách khỏi tồn quầy).
--   * stock_transfers.destination: 'shop' (mặc định, như cũ) hoặc 'company'.
--   * create_transfer thêm p_destination (mặc định 'shop' nên lời gọi cũ vẫn chạy).
--   * create_sale: kênh 'company' trừ qty_company (FIFO theo lô), kênh khác trừ qty_shop như cũ.
--   * get_stock_status trả thêm qty_company; trạng thái hết / sắp hết vẫn tính theo nhà + quầy.
--   * get_break_even: giá trị tồn tính cả hàng ở công ty.
--   * get_daily_product_log: tồn quầy cuối ngày chỉ tính chuyển ra quầy và bán không qua công ty.
--   Dữ liệu cũ: mọi lần chuyển đã có là 'shop', qty_company = 0, nên số liệu không đổi.
--   Thân hàm chép từ bản mới nhất, chỉ sửa các dòng liên quan.
-- =============================================================================

alter table public.stock_batches
  add column qty_company integer not null default 0 check (qty_company >= 0);
alter table public.stock_batches drop constraint stock_batches_check;
alter table public.stock_batches
  add constraint stock_batches_check check (qty_home + qty_shop + qty_company <= initial_qty);

alter table public.stock_transfers
  add column destination text not null default 'shop' check (destination in ('shop', 'company'));

comment on column public.stock_batches.qty_company is 'Hàng đã chuyển cho công ty, chưa bán';
comment on column public.stock_transfers.destination is 'Nơi nhận: shop (quầy) hoặc company (công ty)';

-- Chữ ký create_transfer đổi (thêm p_destination) nên bỏ bản 5 tham số trước
drop function public.create_transfer(uuid, uuid, integer, date, text);

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

  if p_channel is null or p_channel not in ('in_store', 'shopeefood', 'company') then
    raise exception 'Kênh bán không hợp lệ: % (chỉ nhận in_store, shopeefood hoặc company)', p_channel;
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
  if p_channel in ('in_store', 'company') then
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
    and (case when p_channel = 'company' then b.qty_company else b.qty_shop end) > 0
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
        select b.id,
               case when p_channel = 'company' then b.qty_company else b.qty_shop end as qty_avail,
               b.unit_cost
        from public.stock_batches b
        where b.store_id = p_store_id
          and b.product_id = v_product_id
          and (case when p_channel = 'company' then b.qty_company else b.qty_shop end) > 0
          and b.received_date <= v_date
        order by b.received_date, b.id
        for update
      loop
        exit when v_remaining = 0;
        v_take := least(v_batch.qty_avail, v_remaining);

        update public.stock_batches
        set qty_shop    = qty_shop - case when p_channel = 'company' then 0 else v_take end,
            qty_company = qty_company - case when p_channel = 'company' then v_take else 0 end
        where id = v_batch.id;

        insert into public.sale_item_cost_lines (sale_item_id, batch_id, quantity, unit_cost)
        values (v_sale_item_id, v_batch.id, v_take, v_batch.unit_cost);

        v_remaining := v_remaining - v_take;
      end loop;

      if v_remaining > 0 and p_channel = 'company' then
        raise exception 'Không đủ hàng đã chuyển cho công ty của "%" tính đến ngày %: hiện có %, cần bán %. Phân phối cho công ty trước khi bán',
          v_product.name, v_date, v_qty - v_remaining, v_qty;
      end if;
      if v_remaining > 0 then
        raise exception 'Không đủ hàng ở quán cho "%" tính đến ngày %: hiện có %, cần bán %. Nhập hàng và phân phối ra quán trước khi bán',
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

create or replace function public.get_break_even(p_store_id uuid)
returns table (
  total_purchase_cost     numeric,
  total_expenses          numeric,
  total_invested          numeric,
  cumulative_net_revenue  numeric,
  shortfall               numeric,
  pct_recovered           numeric,
  break_even_date         date,
  avg_daily_net_revenue   numeric,
  remaining_stock_value   numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first_sale  date;
  v_today       date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem điểm hoà vốn' using errcode = '42501';
  end if;

  select
    coalesce(sum(b.initial_qty * b.unit_cost), 0),
    coalesce(sum((b.qty_home + b.qty_shop + b.qty_company) * b.unit_cost), 0)
  into total_purchase_cost, remaining_stock_value
  from public.stock_batches b
  where b.store_id = p_store_id;

  select coalesce(sum(e.amount), 0)
  into total_expenses
  from public.expenses e
  where e.store_id = p_store_id;

  total_invested := total_purchase_cost + total_expenses;

  select
    coalesce(sum(s.total_amount - round(s.total_amount * s.commission_rate, 2)), 0),
    min(s.sale_date)
  into cumulative_net_revenue, v_first_sale
  from public.sales s
  where s.store_id = p_store_id;

  shortfall := greatest(total_invested - cumulative_net_revenue, 0);

  if total_invested > 0 then
    pct_recovered := round(cumulative_net_revenue / total_invested * 100, 2);
  else
    pct_recovered := null;
  end if;

  -- Ngày bán đầu tiên mà doanh thu thuần luỹ kế >= vốn đầu tư
  select d.sale_date
  into break_even_date
  from (
    select
      s.sale_date,
      sum(sum(s.total_amount - round(s.total_amount * s.commission_rate, 2)))
        over (order by s.sale_date) as cum
    from public.sales s
    where s.store_id = p_store_id
    group by s.sale_date
  ) d
  where d.cum >= total_invested
  order by d.sale_date
  limit 1;

  if v_first_sale is null then
    avg_daily_net_revenue := 0;
  else
    avg_daily_net_revenue := round(
      cumulative_net_revenue / greatest(v_today - v_first_sale + 1, 1), 2
    );
  end if;

  return next;
end;
$$;

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
    select t.product_id as pid, t.transfer_date as d,
           sum(t.quantity) as q,
           sum(t.quantity) filter (where t.destination = 'shop') as q_shop
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

-- Kiểu trả về đổi (thêm qty_company) nên phải drop rồi tạo lại
drop function public.get_stock_status(uuid);

create or replace function public.get_stock_status(p_store_id uuid)
returns table (
  product_id           uuid,
  product_name         text,
  qty_home             integer,
  qty_shop             integer,
  low_stock_threshold  integer,
  status               text,
  qty_company          integer
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
  select
    p.id,
    p.name,
    coalesce(sum(b.qty_home), 0)::integer,
    coalesce(sum(b.qty_shop), 0)::integer,
    p.low_stock_threshold,
    case
      when coalesce(sum(b.qty_home + b.qty_shop), 0) = 0 then 'out'
      when coalesce(sum(b.qty_home + b.qty_shop), 0) <= p.low_stock_threshold then 'low'
      else 'ok'
    end::text,
    coalesce(sum(b.qty_company), 0)::integer
  from public.products p
  left join public.stock_batches b
    on b.product_id = p.id and b.store_id = p.store_id
  where p.store_id = p_store_id
    and p.tracks_stock
    and p.is_active
  group by p.id, p.name, p.low_stock_threshold
  order by p.name;
end;
$$;

revoke execute on function public.create_transfer(uuid, uuid, integer, date, text, text) from public, anon;
grant execute on function public.create_transfer(uuid, uuid, integer, date, text, text) to authenticated;
revoke execute on function public.get_stock_status(uuid) from public, anon;
grant execute on function public.get_stock_status(uuid) to authenticated;
