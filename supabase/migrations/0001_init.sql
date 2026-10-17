-- =============================================================================
-- 0001_init.sql — Lược đồ ban đầu cho web-nhap-lieu
-- Dán toàn bộ file vào Supabase SQL Editor và chạy một lần từ trên xuống.
--
-- Nguyên tắc bảo mật:
--   * Không cấp bất kỳ quyền nào cho role anon.
--   * Nhân viên (staff) KHÔNG BAO GIỜ đọc được giá vốn, lợi nhuận, chi phí.
--   * Mọi thao tác ghi vào kho và giao dịch chỉ đi qua hàm SECURITY DEFINER.
-- =============================================================================


-- =============================================================================
-- 1. BẢNG
-- =============================================================================

-- Hồ sơ người dùng, 1-1 với auth.users. Vai trò chỉ đổi được bằng SQL (admin).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  role        text not null default 'staff' check (role in ('admin', 'staff')),
  created_at  timestamptz not null default now()
);

-- Cửa hàng: hogi (sữa chua) và bundau (bún đậu).
create table public.stores (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  name                     text not null,
  default_commission_rate  numeric(5,4) not null default 0.25
                           check (default_commission_rate >= 0 and default_commission_rate <= 1),
  created_at               timestamptz not null default now()
);

-- Thành viên cửa hàng: nhân viên chỉ thấy cửa hàng mình thuộc về.
create table public.store_members (
  store_id  uuid not null references public.stores (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  primary key (store_id, user_id)
);
create index store_members_user_id_idx on public.store_members (user_id);

-- Sản phẩm / món. tracks_stock = false với món không quản lý tồn kho (bún đậu).
create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references public.stores (id) on delete cascade,
  name                 text not null,
  category             text,
  sale_price           numeric(14,2) not null default 0 check (sale_price >= 0),
  app_price            numeric(14,2) check (app_price >= 0),
  tracks_stock         boolean not null default true,
  low_stock_threshold  integer not null default 3 check (low_stock_threshold >= 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  unique (store_id, name)
);

-- Giá vốn cố định cho món không quản lý tồn kho. Chỉ admin.
create table public.product_fixed_costs (
  product_id  uuid primary key references public.products (id) on delete cascade,
  unit_cost   numeric(14,2) not null check (unit_cost >= 0)
);

-- Một đợt nhập hàng.
create table public.purchases (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores (id),
  purchase_date  date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  note           text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index purchases_store_id_purchase_date_idx on public.purchases (store_id, purchase_date);
create index purchases_created_by_idx on public.purchases (created_by);

-- Lô hàng (FIFO). Chứa giá vốn nên chỉ admin được đọc.
create table public.stock_batches (
  id             uuid primary key default gen_random_uuid(),
  purchase_id    uuid not null references public.purchases (id),
  store_id       uuid not null references public.stores (id),
  product_id     uuid not null references public.products (id),
  received_date  date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  initial_qty    integer not null check (initial_qty > 0),
  unit_cost      numeric(14,2) not null check (unit_cost >= 0),
  qty_home       integer not null check (qty_home >= 0),
  qty_shop       integer not null default 0 check (qty_shop >= 0),
  created_at     timestamptz not null default now(),
  check (qty_home + qty_shop <= initial_qty)
);
create index stock_batches_purchase_id_idx on public.stock_batches (purchase_id);
create index stock_batches_store_id_received_date_idx on public.stock_batches (store_id, received_date);
-- Chỉ mục phục vụ lấy lô cũ nhất trước (FIFO)
create index stock_batches_product_fifo_idx on public.stock_batches (product_id, received_date, id);

-- Chuyển hàng từ nhà (home) ra quầy (shop).
create table public.stock_transfers (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores (id),
  product_id     uuid not null references public.products (id),
  quantity       integer not null check (quantity > 0),
  transfer_date  date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  note           text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index stock_transfers_store_id_transfer_date_idx on public.stock_transfers (store_id, transfer_date);
create index stock_transfers_product_id_idx on public.stock_transfers (product_id);
create index stock_transfers_created_by_idx on public.stock_transfers (created_by);

-- Đơn bán. total_amount là doanh thu gộp (trước hoa hồng).
create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores (id),
  sale_date        date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  channel          text not null check (channel in ('in_store', 'shopeefood')),
  commission_rate  numeric(5,4) not null default 0
                   check (commission_rate >= 0 and commission_rate <= 1),
  total_amount     numeric(14,2) not null default 0 check (total_amount >= 0),
  note             text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index sales_store_id_sale_date_idx on public.sales (store_id, sale_date);
create index sales_created_by_idx on public.sales (created_by);

-- Dòng hàng của đơn bán.
create table public.sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales (id) on delete cascade,
  product_id  uuid not null references public.products (id),
  quantity    integer not null check (quantity > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0)
);
create index sale_items_sale_id_idx on public.sale_items (sale_id);
create index sale_items_product_id_idx on public.sale_items (product_id);

-- Ảnh chụp giá vốn tại thời điểm bán. batch_id = null với món giá vốn cố định. Chỉ admin.
create table public.sale_item_cost_lines (
  id            uuid primary key default gen_random_uuid(),
  sale_item_id  uuid not null references public.sale_items (id) on delete cascade,
  batch_id      uuid references public.stock_batches (id),
  quantity      integer not null check (quantity > 0),
  unit_cost     numeric(14,2) not null check (unit_cost >= 0)
);
create index sale_item_cost_lines_sale_item_id_idx on public.sale_item_cost_lines (sale_item_id);
create index sale_item_cost_lines_batch_id_idx on public.sale_item_cost_lines (batch_id);

-- Chi phí (gồm cả đồ dùng). Chỉ admin.
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id),
  expense_date  date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  category      text not null,
  amount        numeric(14,2) not null check (amount >= 0),
  note          text,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index expenses_store_id_expense_date_idx on public.expenses (store_id, expense_date);
create index expenses_created_by_idx on public.expenses (created_by);


-- =============================================================================
-- 2. HÀM HỖ TRỢ PHÂN QUYỀN
-- SECURITY DEFINER để đọc profiles/store_members mà không bị RLS gọi đệ quy.
-- =============================================================================

-- Người gọi có phải admin không
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

-- Người gọi có phải thành viên của cửa hàng p_store_id không
create or replace function public.is_store_member(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_store_member(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_store_member(uuid) to authenticated;


-- =============================================================================
-- 3. TRIGGER TẠO PROFILE KHI CÓ USER MỚI
-- Luôn gán role 'staff'. KHÔNG đọc role từ user metadata.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Hàm trigger không ai được gọi trực tiếp
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 4. QUYỀN TRUY CẬP BẢNG (GRANT) — chỉ cho authenticated
-- Thu hồi hết trước để không còn quyền mặc định nào sót lại.
-- =============================================================================

revoke all on table
  public.profiles,
  public.stores,
  public.store_members,
  public.products,
  public.product_fixed_costs,
  public.purchases,
  public.stock_batches,
  public.stock_transfers,
  public.sales,
  public.sale_items,
  public.sale_item_cost_lines,
  public.expenses
from public, anon, authenticated;

-- profiles: chỉ được sửa full_name (không sửa được role)
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Danh mục do admin quản lý (RLS giới hạn ghi cho admin)
grant select, insert, update on public.stores to authenticated;
grant select, insert, update on public.store_members to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.product_fixed_costs to authenticated;

-- Bảng giao dịch: chỉ đọc. Ghi chỉ qua hàm SECURITY DEFINER.
grant select on public.purchases to authenticated;
grant select on public.stock_batches to authenticated;
grant select on public.stock_transfers to authenticated;
grant select on public.sales to authenticated;
grant select on public.sale_items to authenticated;
grant select on public.sale_item_cost_lines to authenticated;

-- Chi phí: admin đọc và thêm
grant select, insert on public.expenses to authenticated;


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================

alter table public.profiles             enable row level security;
alter table public.stores               enable row level security;
alter table public.store_members        enable row level security;
alter table public.products             enable row level security;
alter table public.product_fixed_costs  enable row level security;
alter table public.purchases            enable row level security;
alter table public.stock_batches        enable row level security;
alter table public.stock_transfers      enable row level security;
alter table public.sales                enable row level security;
alter table public.sale_items           enable row level security;
alter table public.sale_item_cost_lines enable row level security;
alter table public.expenses             enable row level security;

-- profiles: xem của mình (admin xem tất cả), chỉ sửa của mình
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- stores
create policy stores_select on public.stores
  for select to authenticated
  using ((select public.is_admin()) or public.is_store_member(id));

create policy stores_insert_admin on public.stores
  for insert to authenticated
  with check ((select public.is_admin()));

create policy stores_update_admin on public.stores
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- store_members
create policy store_members_select on public.store_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy store_members_insert_admin on public.store_members
  for insert to authenticated
  with check ((select public.is_admin()));

create policy store_members_update_admin on public.store_members
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- products
create policy products_select on public.products
  for select to authenticated
  using ((select public.is_admin()) or public.is_store_member(store_id));

create policy products_insert_admin on public.products
  for insert to authenticated
  with check ((select public.is_admin()));

create policy products_update_admin on public.products
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- product_fixed_costs: chỉ admin
create policy product_fixed_costs_select_admin on public.product_fixed_costs
  for select to authenticated
  using ((select public.is_admin()));

create policy product_fixed_costs_insert_admin on public.product_fixed_costs
  for insert to authenticated
  with check ((select public.is_admin()));

create policy product_fixed_costs_update_admin on public.product_fixed_costs
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- purchases: chỉ admin đọc
create policy purchases_select_admin on public.purchases
  for select to authenticated
  using ((select public.is_admin()));

-- stock_batches: chỉ admin đọc (có giá vốn)
create policy stock_batches_select_admin on public.stock_batches
  for select to authenticated
  using ((select public.is_admin()));

-- stock_transfers: admin hoặc thành viên cửa hàng
create policy stock_transfers_select on public.stock_transfers
  for select to authenticated
  using ((select public.is_admin()) or public.is_store_member(store_id));

-- sales: admin, hoặc nhân viên xem đơn do chính mình tạo
create policy sales_select on public.sales
  for select to authenticated
  using (
    (select public.is_admin())
    or (created_by = (select auth.uid()) and public.is_store_member(store_id))
  );

-- sale_items: admin, hoặc dòng thuộc đơn mà nhân viên xem được
create policy sale_items_select on public.sale_items
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1
      from public.sales s
      where s.id = sale_items.sale_id
        and s.created_by = (select auth.uid())
    )
  );

-- sale_item_cost_lines: chỉ admin
create policy sale_item_cost_lines_select_admin on public.sale_item_cost_lines
  for select to authenticated
  using ((select public.is_admin()));

-- expenses: chỉ admin
create policy expenses_select_admin on public.expenses
  for select to authenticated
  using ((select public.is_admin()));

create policy expenses_insert_admin on public.expenses
  for insert to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));


-- =============================================================================
-- 6. HÀM NGHIỆP VỤ (RPC)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_purchase: tạo đợt nhập, mỗi dòng thành một lô ở nhà (qty_home).
-- p_items: [{ "product_id": uuid, "quantity": int, "unit_cost": number }]
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
    if v_unit_cost is null or v_unit_cost < 0 then
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
  end loop;

  insert into public.purchases (store_id, purchase_date, note, created_by)
  values (p_store_id, v_date, p_note, auth.uid())
  returning id into v_purchase_id;

  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    insert into public.stock_batches (
      purchase_id, store_id, product_id, received_date,
      initial_qty, unit_cost, qty_home, qty_shop
    )
    values (
      v_purchase_id,
      p_store_id,
      (v_item ->> 'product_id')::uuid,
      v_date,
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_cost')::numeric,
      (v_item ->> 'quantity')::integer,
      0
    );
  end loop;

  return v_purchase_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_transfer: chuyển hàng từ nhà ra quầy, lấy lô cũ nhất trước (FIFO).
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

  v_remaining := p_quantity;

  for v_batch in
    select b.id, b.qty_home
    from public.stock_batches b
    where b.store_id = p_store_id
      and b.product_id = p_product_id
      and b.qty_home > 0
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
    raise exception 'Không đủ hàng ở nhà cho "%": hiện có %, cần chuyển %',
      v_product.name, p_quantity - v_remaining, p_quantity;
  end if;

  insert into public.stock_transfers (store_id, product_id, quantity, transfer_date, note, created_by)
  values (p_store_id, p_product_id, p_quantity, v_date, p_note, auth.uid())
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_sale: tạo đơn bán trong một giao dịch.
--   * Món có tồn kho: trừ qty_shop theo FIFO, ghi một dòng giá vốn cho mỗi lô.
--   * Món không tồn kho: lấy giá vốn cố định, batch_id = null.
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

    if not v_product.tracks_stock and not exists (
      select 1 from public.product_fixed_costs fc where fc.product_id = v_product_id
    ) then
      raise exception 'Món "%" chưa có giá vốn cố định, cần admin nhập trước khi bán', v_product.name;
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
      select fc.unit_cost into v_fixed_cost
      from public.product_fixed_costs fc
      where fc.product_id = v_product_id;

      insert into public.sale_item_cost_lines (sale_item_id, batch_id, quantity, unit_cost)
      values (v_sale_item_id, null, v_qty, v_fixed_cost);
    end if;
  end loop;

  return v_sale_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- get_stock_status: tồn kho từng sản phẩm (chỉ số lượng, KHÔNG có giá vốn).
-- Trạng thái tính trên tổng tồn (nhà + quầy):
--   out = 0, low = <= ngưỡng, ok = còn lại. Chỉ sản phẩm đang bán và có quản lý tồn.
-- -----------------------------------------------------------------------------
create or replace function public.get_stock_status(p_store_id uuid)
returns table (
  product_id           uuid,
  product_name         text,
  qty_home             integer,
  qty_shop             integer,
  low_stock_threshold  integer,
  status               text
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
    end::text
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

-- -----------------------------------------------------------------------------
-- get_pnl: lãi/lỗ theo ngày / tuần (bắt đầu thứ Hai) / tháng. Chỉ admin.
-- Có cả kỳ chỉ có chi phí hoặc chỉ có doanh thu.
-- -----------------------------------------------------------------------------
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
    where e.store_id = p_store_id
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

-- -----------------------------------------------------------------------------
-- get_break_even: điểm hoà vốn. Chỉ admin.
--   Vốn đầu tư = tổng tiền nhập hàng + tổng chi phí.
--   Hoà vốn khi doanh thu thuần luỹ kế >= vốn đầu tư.
--   Doanh thu thuần bình quân/ngày = luỹ kế / số ngày từ đơn đầu tiên đến hôm nay.
-- -----------------------------------------------------------------------------
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
    coalesce(sum((b.qty_home + b.qty_shop) * b.unit_cost), 0)
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

-- Quyền gọi hàm nghiệp vụ: chỉ authenticated (get_pnl / get_break_even tự chặn non-admin)
revoke execute on function public.create_purchase(uuid, date, text, jsonb) from public, anon;
revoke execute on function public.create_transfer(uuid, uuid, integer, date, text) from public, anon;
revoke execute on function public.create_sale(uuid, date, text, text, jsonb, numeric) from public, anon;
revoke execute on function public.get_stock_status(uuid) from public, anon;
revoke execute on function public.get_pnl(uuid, text, date, date) from public, anon;
revoke execute on function public.get_break_even(uuid) from public, anon;

grant execute on function public.create_purchase(uuid, date, text, jsonb) to authenticated;
grant execute on function public.create_transfer(uuid, uuid, integer, date, text) to authenticated;
grant execute on function public.create_sale(uuid, date, text, text, jsonb, numeric) to authenticated;
grant execute on function public.get_stock_status(uuid) to authenticated;
grant execute on function public.get_pnl(uuid, text, date, date) to authenticated;
grant execute on function public.get_break_even(uuid) to authenticated;


-- =============================================================================
-- 7. DỮ LIỆU KHỞI TẠO: hai cửa hàng (chạy lại không bị trùng)
-- =============================================================================

insert into public.stores (code, name)
values
  ('hogi',   'Hogi Food'),
  ('bundau', 'Bún Đậu Em Thuỷ')
on conflict (code) do nothing;


-- =============================================================================
-- 8. LỆNH CHẠY TAY (đang bị comment — sửa email rồi bỏ comment để chạy)
-- =============================================================================

-- Nâng một user lên admin theo email (tạo profile nếu user đăng ký trước khi chạy file này):
-- insert into public.profiles (id, role)
-- select u.id, 'admin' from auth.users u where u.email = 'email-cua-ban@example.com'
-- on conflict (id) do update set role = 'admin';

-- Thêm một user vào cửa hàng (đổi 'hogi' thành 'bundau' nếu cần):
-- insert into public.profiles (id)
-- select u.id from auth.users u where u.email = 'nhan-vien@example.com'
-- on conflict (id) do nothing;
-- insert into public.store_members (store_id, user_id)
-- select s.id, u.id
-- from public.stores s, auth.users u
-- where s.code = 'hogi' and u.email = 'nhan-vien@example.com'
-- on conflict do nothing;
