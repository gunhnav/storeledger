-- =============================================================================
-- Chi phí sinh tự động từ phiếu nhập kho (Bún đậu)
--   * expenses.purchase_id: khoản chi tạo từ đợt nhập hàng (xoá đợt nhập thì xoá theo).
--   * Giá vốn đã tính qua lô hàng (FIFO) và "Nhập hàng" ở điểm hoà vốn, nên các báo cáo
--     lãi lỗ / hoà vốn / nhật ký ngày bỏ qua khoản chi có purchase_id để không tính hai lần.
--     Báo cáo "Chi phí theo ngày" vẫn tính đủ.
-- =============================================================================

alter table public.expenses
  add column if not exists purchase_id uuid references public.purchases (id) on delete cascade;
create index if not exists expenses_purchase_id_idx on public.expenses (purchase_id) where purchase_id is not null;
comment on column public.expenses.purchase_id is 'Khoản chi sinh từ đợt nhập kho; báo cáo lãi lỗ / hoà vốn bỏ qua để tránh tính hai lần với giá vốn';

create or replace function public.get_pnl(
  p_store_id  uuid,
  p_period    text,
  p_from      date,
  p_to        date
)
returns table (
  period_start   date,
  gross_revenue  numeric,
  commission     numeric,
  net_revenue    numeric,
  cogs           numeric,
  gross_profit   numeric,
  expenses       numeric,
  net_profit     numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem báo cáo lãi lỗ' using errcode = '42501';
  end if;

  if p_period is null or p_period not in ('day', 'week', 'month') then
    raise exception 'Kỳ báo cáo không hợp lệ: % (chỉ nhận day, week, month)', p_period;
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Khoảng ngày không hợp lệ';
  end if;

  return query
  with rev as (
    select
      date_trunc(p_period, s.sale_date::timestamp)::date as ps,
      sum(s.total_amount) as gross,
      sum(round(s.total_amount * s.commission_rate, 2)) as comm
    from public.sales s
    where s.store_id = p_store_id
      and s.sale_date between p_from and p_to
    group by 1
  ),
  cg as (
    select
      date_trunc(p_period, s.sale_date::timestamp)::date as ps,
      sum(cl.quantity * cl.unit_cost) as amt
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    join public.sale_item_cost_lines cl on cl.sale_item_id = si.id
    where s.store_id = p_store_id
      and s.sale_date between p_from and p_to
    group by 1
  ),
  ex as (
    select
      date_trunc(p_period, e.expense_date::timestamp)::date as ps,
      sum(e.amount) as amt
    from public.expenses e
    where e.store_id = p_store_id and e.purchase_id is null
      and e.expense_date between p_from and p_to
    group by 1
  ),
  pr as (
    select rev.ps from rev
    union
    select ex.ps from ex
  )
  select
    pr.ps,
    coalesce(rev.gross, 0)::numeric,
    coalesce(rev.comm, 0)::numeric,
    (coalesce(rev.gross, 0) - coalesce(rev.comm, 0))::numeric,
    coalesce(cg.amt, 0)::numeric,
    (coalesce(rev.gross, 0) - coalesce(rev.comm, 0) - coalesce(cg.amt, 0))::numeric,
    coalesce(ex.amt, 0)::numeric,
    (coalesce(rev.gross, 0) - coalesce(rev.comm, 0) - coalesce(cg.amt, 0) - coalesce(ex.amt, 0))::numeric
  from pr
  left join rev on rev.ps = pr.ps
  left join cg  on cg.ps  = pr.ps
  left join ex  on ex.ps  = pr.ps
  order by pr.ps;
end;
$$;

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
    select min(e.expense_date) from public.expenses e where e.store_id = p_store_id and e.purchase_id is null
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
    where e.store_id = p_store_id and e.purchase_id is null and e.expense_date <= p_to
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
  where e.store_id = p_store_id and e.purchase_id is null;

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

-- -----------------------------------------------------------------------------
-- record_purchase_expenses: sinh khoản chi phí từ các lô của một đợt nhập (mỗi lô một dòng).
--   Nhân viên cũng gọi được (như create_purchase) nên ghi qua SECURITY DEFINER, bảng expenses
--   vẫn chỉ admin đọc. Gọi lại cho cùng đợt nhập thì không tạo thêm.
-- -----------------------------------------------------------------------------
create or replace function public.record_purchase_expenses(
  p_purchase_id  uuid,
  p_category     text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase  record;
  v_count     integer;
begin
  select p.store_id, p.purchase_date into v_purchase
  from public.purchases p
  where p.id = p_purchase_id;
  if not found then
    raise exception 'Không tìm thấy đợt nhập';
  end if;
  if not (public.is_admin() or public.is_store_member(v_purchase.store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('Đồ uống', 'Nguyên liệu') then
    raise exception 'Nhóm chi phí không hợp lệ';
  end if;
  if exists (select 1 from public.expenses e where e.purchase_id = p_purchase_id) then
    return 0;
  end if;

  insert into public.expenses (store_id, expense_date, category, amount, quantity, unit_price, note, purchase_id)
  select v_purchase.store_id, v_purchase.purchase_date, p_category,
         b.initial_qty * b.unit_cost, b.initial_qty, b.unit_cost, 'Nhập kho: ' || pr.name, p_purchase_id
  from public.stock_batches b
  join public.products pr on pr.id = b.product_id
  where b.purchase_id = p_purchase_id and b.initial_qty * b.unit_cost > 0;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.record_purchase_expenses(uuid, text) from public, anon;
grant execute on function public.record_purchase_expenses(uuid, text) to authenticated;
