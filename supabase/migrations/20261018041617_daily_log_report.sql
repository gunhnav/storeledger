-- =============================================================================
-- daily_log_report — Báo cáo "Nhật ký ngày" theo mẫu Google Sheet (chỉ admin).
-- Chỉ thêm hàm đọc, không đổi bảng hay hàm có sẵn.
-- Quy ước giống get_pnl: hoa hồng = round(total_amount * commission_rate, 2).
-- Khoảng ngày tối đa 366 ngày.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- get_daily_product_log: số liệu từng (ngày, sản phẩm).
--   * Món đếm tồn: đủ mọi ngày trong khoảng, kèm tồn cuối ngày
--       home_end = đã nhập − đã chuyển ra quầy (tính từ lô đầu tiên)
--       shop_end = đã chuyển ra quầy − đã bán
--   * Món không đếm tồn: chỉ các ngày có bán, home_end / shop_end = null.
-- -----------------------------------------------------------------------------
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
    select t.product_id as pid, t.transfer_date as d, sum(t.quantity) as q
    from public.stock_transfers t
    where t.store_id = p_store_id and t.transfer_date <= p_to
    group by 1, 2
  ),
  sold as (
    select si.product_id as pid, s.sale_date as d,
           sum(si.quantity) as q,
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
      coalesce(sold.q, 0) as sold_q,
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
      sum(s.tr_q - s.sold_q) over w as shop_q
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

-- -----------------------------------------------------------------------------
-- get_daily_summary: mỗi ngày trong khoảng một dòng (ngày trống có số 0).
--   Các cột luỹ kế tính từ giao dịch đầu tiên của cửa hàng.
--   Dòng tiền ròng luỹ kế = doanh thu thuần luỹ kế − vốn đã chi luỹ kế.
--   is_break_even = true từ ngày đầu tiên doanh thu thuần luỹ kế >= vốn luỹ kế (> 0).
--   price_notes: các lần đổi giá áp dụng từ ngày đó, so với dòng giá liền trước.
-- -----------------------------------------------------------------------------
create or replace function public.get_daily_summary(
  p_store_id  uuid,
  p_from      date,
  p_to        date
)
returns table (
  day              date,
  qty_sold         integer,
  gross_revenue    numeric,
  commission       numeric,
  net_revenue      numeric,
  expenses         numeric,
  cogs             numeric,
  gross_profit     numeric,
  net_profit       numeric,
  purchase_cost    numeric,
  cum_invested     numeric,
  cum_net_revenue  numeric,
  cum_cash_flow    numeric,
  is_break_even    boolean,
  price_notes      text
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

  -- Ngày giao dịch đầu tiên của cửa hàng, để cộng dồn vốn và doanh thu từ đầu
  select least(p_from, coalesce(min(x.d), p_from))
  into v_start
  from (
    select min(s.sale_date) as d from public.sales s where s.store_id = p_store_id
    union all
    select min(e.expense_date) from public.expenses e where e.store_id = p_store_id
    union all
    select min(b.received_date) from public.stock_batches b where b.store_id = p_store_id
  ) x;

  return query
  with days as (
    select gs::date as d
    from generate_series(v_start, p_to, interval '1 day') as gs
  ),
  rev as (
    select s.sale_date as d,
           sum(s.total_amount) as gross,
           sum(round(s.total_amount * s.commission_rate, 2)) as comm
    from public.sales s
    where s.store_id = p_store_id and s.sale_date <= p_to
    group by 1
  ),
  qty as (
    select s.sale_date as d, sum(si.quantity) as q
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    where s.store_id = p_store_id and s.sale_date between p_from and p_to
    group by 1
  ),
  cg as (
    select s.sale_date as d, sum(cl.quantity * cl.unit_cost) as amt
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    join public.sale_item_cost_lines cl on cl.sale_item_id = si.id
    where s.store_id = p_store_id and s.sale_date between p_from and p_to
    group by 1
  ),
  ex as (
    select e.expense_date as d, sum(e.amount) as amt
    from public.expenses e
    where e.store_id = p_store_id and e.expense_date <= p_to
    group by 1
  ),
  pu as (
    select b.received_date as d, sum(b.initial_qty * b.unit_cost) as amt
    from public.stock_batches b
    where b.store_id = p_store_id and b.received_date <= p_to
    group by 1
  ),
  daily as (
    select
      days.d,
      coalesce(qty.q, 0) as q,
      coalesce(rev.gross, 0) as gross,
      coalesce(rev.comm, 0) as comm,
      coalesce(rev.gross, 0) - coalesce(rev.comm, 0) as net,
      coalesce(ex.amt, 0) as exp_amt,
      coalesce(cg.amt, 0) as cogs_amt,
      coalesce(pu.amt, 0) as pur_amt
    from days
    left join rev on rev.d = days.d
    left join qty on qty.d = days.d
    left join cg  on cg.d  = days.d
    left join ex  on ex.d  = days.d
    left join pu  on pu.d  = days.d
  ),
  cum as (
    select
      daily.*,
      sum(daily.pur_amt + daily.exp_amt) over w as inv,
      sum(daily.net) over w as cnet
    from daily
    window w as (order by daily.d rows between unbounded preceding and current row)
  ),
  be as (
    select min(cum.d) as d from cum where cum.inv > 0 and cum.cnet >= cum.inv
  ),
  -- Ghi chú đổi giá: số định dạng kiểu 10.000, giá trống ghi '—'
  pp as (
    select
      pr.effective_from as d,
      p.name,
      pr.note,
      lag(pr.effective_from) over w as prev_d,
      pr.sale_price, lag(pr.sale_price) over w as prev_sale,
      pr.app_price,  lag(pr.app_price)  over w as prev_app,
      pr.unit_cost,  lag(pr.unit_cost)  over w as prev_cost
    from public.product_prices pr
    join public.products p on p.id = pr.product_id
    where p.store_id = p_store_id and pr.effective_from <= p_to
    window w as (partition by pr.product_id order by pr.effective_from)
  ),
  pp_fmt as (
    select
      pp.*,
      coalesce(replace(to_char(pp.sale_price, 'FM999,999,999,990'), ',', '.'), '—') as f_sale,
      coalesce(replace(to_char(pp.prev_sale,  'FM999,999,999,990'), ',', '.'), '—') as f_prev_sale,
      coalesce(replace(to_char(pp.app_price,  'FM999,999,999,990'), ',', '.'), '—') as f_app,
      coalesce(replace(to_char(pp.prev_app,   'FM999,999,999,990'), ',', '.'), '—') as f_prev_app,
      coalesce(replace(to_char(pp.unit_cost,  'FM999,999,999,990'), ',', '.'), '—') as f_cost,
      coalesce(replace(to_char(pp.prev_cost,  'FM999,999,999,990'), ',', '.'), '—') as f_prev_cost
    from pp
    where pp.d between p_from and p_to
  ),
  notes as (
    select
      f.d,
      string_agg(
        f.name || ': ' ||
        coalesce(nullif(concat_ws(', ',
          case when f.prev_d is null then 'giá bán ' || f.f_sale
               when f.sale_price is distinct from f.prev_sale then 'giá bán ' || f.f_prev_sale || '→' || f.f_sale end,
          case when f.prev_d is not null and f.app_price is distinct from f.prev_app
               then 'giá app ' || f.f_prev_app || '→' || f.f_app end,
          case when f.prev_d is null then 'giá vốn ' || f.f_cost
               when f.unit_cost is distinct from f.prev_cost then 'giá vốn ' || f.f_prev_cost || '→' || f.f_cost end
        ), ''), 'giữ nguyên giá') ||
        coalesce(' – ' || f.note, ''),
        '; ' order by f.name
      ) as txt
    from pp_fmt f
    group by f.d
  )
  select
    c.d,
    c.q::integer,
    c.gross,
    c.comm,
    c.net,
    c.exp_amt,
    c.cogs_amt,
    c.net - c.cogs_amt,
    c.net - c.cogs_amt - c.exp_amt,
    c.pur_amt,
    c.inv,
    c.cnet,
    c.cnet - c.inv,
    coalesce(c.d >= be.d, false),
    notes.txt
  from cum c
  cross join be
  left join notes on notes.d = c.d
  where c.d between p_from and p_to
  order by c.d;
end;
$$;

revoke execute on function public.get_daily_product_log(uuid, date, date) from public, anon;
revoke execute on function public.get_daily_summary(uuid, date, date) from public, anon;
grant execute on function public.get_daily_product_log(uuid, date, date) to authenticated;
grant execute on function public.get_daily_summary(uuid, date, date) to authenticated;
