-- =============================================================================
-- 1. Hỗ trợ giá set mix riêng cho từng dòng món (Sữa chua vs Bánh flan) trong storefront_set_prices.
-- 2. Đổi tên "Bánh flan" thành "Flan truyền thống", thêm 2 vị "Flan matcha" và "Flan phô mai" cho Hogi,
--    cùng bảng giá set Bánh flan: toàn Flan truyền thống (40k / 60k), mix vị Bánh flan (50k / 70k).
-- 3. Đồng bộ bảng company_sets khi chuyển hàng từ Công ty về Nhà (create_company_return)
--    để set đã hoàn về nhà không còn hiện tồn ở Công ty.
-- =============================================================================

-- 1) Thêm cột category cho storefront_set_prices (áp dụng khi product_id IS NULL = giá mix của dòng món đó)
alter table public.storefront_set_prices
  add column if not exists category text;

drop index if exists public.storefront_set_prices_unique;
create unique index if not exists storefront_set_prices_unique
  on public.storefront_set_prices (
    store_id,
    set_size,
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(category, '')
  );

-- Cập nhật save_storefront_set_prices nhận thêm category cho dòng giá mix
create or replace function public.save_storefront_set_prices(p_store_id uuid, p_rules jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_rule  jsonb;
  v_count integer := 0;
  v_pid   uuid;
  v_cat   text;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa bảng giá set' using errcode = '42501';
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    raise exception 'Bảng giá set không hợp lệ';
  end if;

  delete from public.storefront_set_prices where store_id = p_store_id;
  for v_rule in select e.value from jsonb_array_elements(p_rules) as e(value) loop
    v_pid := nullif(v_rule ->> 'product_id', '')::uuid;
    v_cat := case when v_pid is null then nullif(btrim(coalesce(v_rule ->> 'category', '')), '') else null end;
    if v_pid is not null and not exists (select 1 from public.products p where p.id = v_pid and p.store_id = p_store_id) then
      raise exception 'Sản phẩm không thuộc cửa hàng này';
    end if;
    insert into public.storefront_set_prices (store_id, set_size, product_id, category, price)
    values (p_store_id, (v_rule ->> 'size')::integer, v_pid, v_cat, (v_rule ->> 'price')::numeric);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.save_storefront_set_prices(uuid, jsonb) from public, anon;
grant execute on function public.save_storefront_set_prices(uuid, jsonb) to authenticated;

-- Cập nhật get_public_menu trả thêm category trong set_prices
create or replace function public.get_public_menu(p_store_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store  record;
  v_today  date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_items  jsonb;
  v_prices jsonb;
  v_bank   jsonb := null;
  v_pay    jsonb := null;
begin
  select s.id, s.name, s.public_phone, s.public_tagline, s.public_contact_domain, s.public_floors, s.public_chat_url, s.public_contact_email,
         s.public_bank_code, s.public_bank_account, s.public_bank_holder, s.public_qr_payload, s.public_qr_label into v_store
  from public.stores s
  where s.code = lower(btrim(coalesce(p_store_code, ''))) and s.is_public;
  if not found then
    return null;
  end if;

  if v_store.public_bank_code is not null and v_store.public_bank_account is not null and v_store.public_bank_holder is not null then
    v_bank := jsonb_build_object('code', v_store.public_bank_code, 'account', v_store.public_bank_account, 'holder', v_store.public_bank_holder);
  end if;
  if v_store.public_qr_payload is not null and v_store.public_bank_holder is not null then
    v_pay := jsonb_build_object('payload', v_store.public_qr_payload, 'label', v_store.public_qr_label, 'holder', v_store.public_bank_holder);
  end if;

  select coalesce(jsonb_agg(i order by i.sort_group, i.name), '[]'::jsonb) into v_items
  from (
    select
      p.id,
      p.name,
      p.category,
      p.public_sale_mode as mode,
      case when p.category is null then 1 else 0 end as sort_group,
      (select pp.sale_price from public.product_prices pp
        where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
        order by pp.effective_from desc limit 1) as price
    from public.products p
    where p.store_id = v_store.id and p.is_active
  ) i;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('size', r.set_size, 'product_id', r.product_id, 'category', r.category, 'price', r.price)
      order by r.set_size, r.product_id nulls last, r.category nulls last
    ),
    '[]'::jsonb
  )
  into v_prices
  from public.storefront_set_prices r
  where r.store_id = v_store.id;

  return jsonb_build_object(
    'store', jsonb_build_object('name', v_store.name, 'phone', v_store.public_phone, 'tagline', v_store.public_tagline,
                                'domain', v_store.public_contact_domain, 'floors', v_store.public_floors, 'chat_url', v_store.public_chat_url, 'contact_email', v_store.public_contact_email, 'bank', v_bank, 'pay', v_pay, 'set_prices', v_prices),
    'items', v_items
  );
end;
$$;
revoke execute on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;

-- Cập nhật submit_preorder tra giá mix theo đúng category của dòng món trước khi fallback về category NULL
create or replace function public.submit_preorder(p_store_code text, p_order jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store     record;
  v_today     date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_name      text := btrim(coalesce(p_order ->> 'name', ''));
  v_domain    text := lower(regexp_replace(btrim(coalesce(p_order ->> 'domain', '')), '@.*$', ''));
  v_floor     text := upper(btrim(regexp_replace(btrim(coalesce(p_order ->> 'floor', '')), '^(f|tầng|tang|lầu|lau)\s*', '', 'i')));
  v_payment   text := coalesce(p_order ->> 'payment', 'transfer');
  v_line      jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_total     numeric := 0;
  v_qty       integer;
  v_size      integer;
  v_unit      numeric;
  v_pid       uuid;
  v_prod      record;
  v_entry     record;
  v_count     integer;
  v_jars      integer;
  v_category  text;
  v_line_size integer;
  v_sum       numeric;
  v_detail    text;
  v_code      text;
  v_alphabet  text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_try       integer := 0;
begin
  select s.id, s.code, s.public_floors into v_store from public.stores s
  where s.code = lower(btrim(coalesce(p_store_code, ''))) and s.is_public;
  if not found then
    raise exception 'Không tìm thấy cửa hàng';
  end if;

  if char_length(v_name) not between 1 and 60 then raise exception 'Nhập tên của bạn'; end if;
  if v_domain !~ '^[a-z0-9._-]{2,40}$' then raise exception 'Domain chưa đúng (vd: huong.vu3)'; end if;
  if v_floor !~ '^[A-Z0-9]{1,4}$' or (v_store.public_floors is not null and not (v_floor = any (v_store.public_floors))) then
    raise exception 'Tầng chưa đúng, chỉ giao tầng %', array_to_string(coalesce(v_store.public_floors, '{}'), ', ');
  end if;
  if v_payment not in ('transfer', 'cash') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  if jsonb_typeof(p_order -> 'lines') <> 'array' or jsonb_array_length(p_order -> 'lines') not between 1 and 30 then
    raise exception 'Đơn chưa có món nào';
  end if;

  select count(*) into v_count from public.preorders p
  where p.store_id = v_store.id and p.customer_domain = v_domain and p.created_at > now() - interval '10 minutes';
  if v_count >= 5 then raise exception 'Bạn vừa đặt nhiều đơn liên tiếp, thử lại sau ít phút nhé'; end if;

  for v_line in select e.value from jsonb_array_elements(p_order -> 'lines') as e(value) loop
    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty not between 1 and 99 then raise exception 'Số lượng không hợp lệ'; end if;

    if v_line ->> 'kind' = 'single' then
      v_pid := (v_line ->> 'product_id')::uuid;
      select p.id, p.name, (select pp.sale_price from public.product_prices pp
                             where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
                             order by pp.effective_from desc limit 1) as price
      into v_prod from public.products p
      where p.id = v_pid and p.store_id = v_store.id and p.is_active and p.public_sale_mode = 'single';
      if not found or v_prod.price is null then raise exception 'Món không còn bán lẻ'; end if;
      v_unit := v_prod.price;
      v_out := v_out || jsonb_build_object('kind', 'single', 'product_id', v_prod.id, 'title', v_prod.name, 'detail', 'Bán lẻ', 'qty', v_qty, 'unit_price', v_unit);

    elsif v_line ->> 'kind' = 'set' then
      v_size := (v_line ->> 'size')::integer;
      if v_size not in (4, 6) or jsonb_typeof(v_line -> 'mix') <> 'object' then raise exception 'Set không hợp lệ'; end if;
      v_jars := 0; v_sum := 0; v_count := 0; v_category := null; v_detail := '';
      for v_entry in
        select (e.key)::uuid as pid, (e.value)::integer as n, p.name, p.category,
               (select pp.sale_price from public.product_prices pp
                 where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
                 order by pp.effective_from desc limit 1) as price
        from jsonb_each_text(v_line -> 'mix') as e
        left join public.products p on p.id = (e.key)::uuid and p.store_id = v_store.id and p.is_active and p.public_sale_mode = 'set'
        where (e.value)::integer > 0
        order by p.name
      loop
        if v_entry.name is null then raise exception 'Vị trong set không còn bán'; end if;
        if v_category is not null and v_entry.category is distinct from v_category then raise exception 'Một set chỉ gồm các vị cùng loại'; end if;
        v_category := v_entry.category;
        v_jars := v_jars + v_entry.n;
        v_count := v_count + 1;
        v_pid := v_entry.pid;
        v_sum := case when v_sum is null or v_entry.price is null then null else v_sum + v_entry.n * v_entry.price end;
        v_detail := v_detail || case when v_detail = '' then '' else ' + ' end || v_entry.n || ' ' || v_entry.name;
      end loop;
      if v_jars <> v_size then raise exception 'Set % hũ phải chọn đủ % hũ', v_size, v_size; end if;

      -- Giá set: giá riêng cho set một vị -> giá mix của dòng món (ưu tiên khớp category rồi mới tới mặc định) -> cộng giá từng hũ
      v_unit := null;
      if v_count = 1 then
        select r.price into v_unit from public.storefront_set_prices r where r.store_id = v_store.id and r.set_size = v_size and r.product_id = v_pid;
      end if;
      if v_unit is null then
        select count(*) into v_line_size from public.products p
        where p.store_id = v_store.id and p.is_active and p.public_sale_mode = 'set' and p.category is not distinct from v_category;
        if v_line_size >= 2 then
          select r.price into v_unit
          from public.storefront_set_prices r
          where r.store_id = v_store.id
            and r.set_size = v_size
            and r.product_id is null
            and (r.category = v_category or r.category is null)
          order by (r.category is null) asc
          limit 1;
        end if;
      end if;
      v_unit := coalesce(v_unit, v_sum);
      if v_unit is null then raise exception 'Set chưa có giá'; end if;
      v_out := v_out || jsonb_build_object('kind', 'set', 'size', v_size, 'mix', v_line -> 'mix', 'title', 'Set ' || v_size || ' hũ', 'detail', v_detail, 'qty', v_qty, 'unit_price', v_unit);
    else
      raise exception 'Loại món không hợp lệ';
    end if;
    v_total := v_total + v_unit * v_qty;
  end loop;

  loop
    v_try := v_try + 1;
    v_code := case when v_store.code = 'hogi' then 'HG' else upper(left(v_store.code, 2)) end
              || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YY')
              || lpad(extract(doy from (now() at time zone 'Asia/Ho_Chi_Minh'))::text, 3, '0')
              || (select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from public.preorders p where p.store_id = v_store.id and p.code = v_code) or v_try >= 8;
  end loop;

  insert into public.preorders (store_id, code, customer_name, customer_domain, floor, payment, lines, total)
  values (v_store.id, v_code, v_name, v_domain, v_floor, v_payment, v_out, v_total);

  return jsonb_build_object('code', v_code, 'total', v_total, 'lines', v_out);
end;
$$;
revoke execute on function public.submit_preorder(text, jsonb) from public;
grant execute on function public.submit_preorder(text, jsonb) to anon, authenticated;

-- 2) Thêm Flan matcha, Flan phô mai, đổi tên Bánh flan -> Flan truyền thống và cấu hình giá set cho Hogi
do $$
declare
  v_store_id    uuid;
  v_flan_tt_id  uuid;
  v_flan_mc_id  uuid;
  v_flan_pm_id  uuid;
begin
  select s.id into v_store_id from public.stores s where s.code = 'hogi';
  if v_store_id is null then
    return;
  end if;

  -- Đổi tên "Bánh flan" hiện tại thành "Flan truyền thống"
  update public.products
  set name = 'Flan truyền thống', category = 'Bánh flan', public_sale_mode = 'set'
  where store_id = v_store_id and name = 'Bánh flan'
    and not exists (select 1 from public.products p2 where p2.store_id = v_store_id and p2.name = 'Flan truyền thống');

  select p.id into v_flan_tt_id from public.products p where p.store_id = v_store_id and p.name = 'Flan truyền thống';

  -- Thêm Flan matcha
  insert into public.products (store_id, name, category, tracks_stock, low_stock_threshold, is_active, public_sale_mode)
  values (v_store_id, 'Flan matcha', 'Bánh flan', true, 3, true, 'set')
  on conflict (store_id, name) do update
    set category = 'Bánh flan', is_active = true, public_sale_mode = 'set'
  returning id into v_flan_mc_id;

  if not exists (select 1 from public.product_prices pp where pp.product_id = v_flan_mc_id) then
    insert into public.product_prices (product_id, effective_from, sale_price, note)
    values (v_flan_mc_id, date '2026-10-25', 12500, 'Giá bán trang đặt trước');
  end if;

  -- Thêm Flan phô mai
  insert into public.products (store_id, name, category, tracks_stock, low_stock_threshold, is_active, public_sale_mode)
  values (v_store_id, 'Flan phô mai', 'Bánh flan', true, 3, true, 'set')
  on conflict (store_id, name) do update
    set category = 'Bánh flan', is_active = true, public_sale_mode = 'set'
  returning id into v_flan_pm_id;

  if not exists (select 1 from public.product_prices pp where pp.product_id = v_flan_pm_id) then
    insert into public.product_prices (product_id, effective_from, sale_price, note)
    values (v_flan_pm_id, date '2026-10-25', 12500, 'Giá bán trang đặt trước');
  end if;

  -- Gán category = 'Sữa chua' cho dòng giá mix hiện tại (55k / 80k)
  update public.storefront_set_prices
  set category = 'Sữa chua'
  where store_id = v_store_id and product_id is null and category is null;

  -- Giá set riêng cho Flan truyền thống (40k / 60k)
  if v_flan_tt_id is not null then
    insert into public.storefront_set_prices (store_id, set_size, product_id, category, price)
    values
      (v_store_id, 4, v_flan_tt_id, null, 40000),
      (v_store_id, 6, v_flan_tt_id, null, 60000)
    on conflict (store_id, set_size, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(category, ''))
    do update set price = excluded.price;
  end if;

  -- Giá set mix vị Bánh flan: Set 4 = 50k, Set 6 = 70k
  insert into public.storefront_set_prices (store_id, set_size, product_id, category, price)
  values
    (v_store_id, 4, null, 'Bánh flan', 50000),
    (v_store_id, 6, null, 'Bánh flan', 70000)
  on conflict (store_id, set_size, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(category, ''))
  do update set price = excluded.price;
end $$;

-- 3) Cập nhật create_company_return: khi chuyển hàng từ Công ty về Nhà, tự động giảm/xoá các set chưa bán tương ứng trong company_sets
create or replace function public.create_company_return(
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
  v_company_left integer;
  v_sets_jars    integer;
  v_cs           record;
  v_per_set      integer;
  v_unsold       integer;
  v_drop         integer;
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
    select b.id, b.qty_company
    from public.stock_batches b
    where b.store_id = p_store_id
      and b.product_id = p_product_id
      and b.qty_company > 0
    order by b.received_date desc, b.id desc
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_batch.qty_company, v_remaining);

    update public.stock_batches
    set qty_company = qty_company - v_take,
        qty_home    = qty_home + v_take
    where id = v_batch.id;

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Không đủ hàng ở công ty cho "%": hiện có %, cần chuyển về %. Chuyển hàng cho công ty trước',
      v_product.name, p_quantity - v_remaining, p_quantity;
  end if;

  -- Đồng bộ lại company_sets: nếu tổng hũ của vị này trong các set chưa bán vượt số tồn thực tế ở công ty thì trừ bớt set (lần phân phối mới nhất trước)
  select coalesce(sum(b.qty_company), 0) into v_company_left
  from public.stock_batches b
  where b.store_id = p_store_id and b.product_id = p_product_id;

  select coalesce(sum((cs.set_count - cs.sold_count) * coalesce((cs.mix ->> p_product_id::text)::integer, 0)), 0)
  into v_sets_jars
  from public.company_sets cs
  where cs.store_id = p_store_id
    and cs.set_count > cs.sold_count
    and coalesce((cs.mix ->> p_product_id::text)::integer, 0) > 0;

  if v_sets_jars > v_company_left then
    for v_cs in
      select cs.id, cs.set_count, cs.sold_count, coalesce((cs.mix ->> p_product_id::text)::integer, 0) as per_set
      from public.company_sets cs
      where cs.store_id = p_store_id
        and cs.set_count > cs.sold_count
        and coalesce((cs.mix ->> p_product_id::text)::integer, 0) > 0
      order by cs.distribution_date desc, cs.created_at desc
      for update
    loop
      exit when v_sets_jars <= v_company_left;
      v_per_set := v_cs.per_set;
      v_unsold  := v_cs.set_count - v_cs.sold_count;
      v_drop    := least(v_unsold, ceil((v_sets_jars - v_company_left)::numeric / v_per_set)::integer);
      if v_drop > 0 then
        if v_cs.set_count - v_drop <= 0 then
          delete from public.company_sets where id = v_cs.id;
        else
          update public.company_sets set set_count = set_count - v_drop where id = v_cs.id;
        end if;
        v_sets_jars := v_sets_jars - v_drop * v_per_set;
      end if;
    end loop;
  end if;

  insert into public.stock_transfers (store_id, product_id, quantity, transfer_date, note, destination, created_by)
  values (p_store_id, p_product_id, p_quantity, v_date, coalesce(nullif(btrim(p_note), ''), 'Chuyển từ công ty về nhà'), 'home', auth.uid())
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;
revoke execute on function public.create_company_return(uuid, uuid, integer, date, text) from public, anon;
grant execute on function public.create_company_return(uuid, uuid, integer, date, text) to authenticated;

-- Đồng bộ dữ liệu hiện có: xoá / giảm các set chưa bán trong company_sets mà hàng đã được chuyển từ công ty về nhà trước đó
do $$
declare
  v_prod         record;
  v_company_left integer;
  v_sets_jars    integer;
  v_cs           record;
  v_drop         integer;
begin
  for v_prod in select p.id, p.store_id from public.products p where p.tracks_stock loop
    select coalesce(sum(b.qty_company), 0) into v_company_left
    from public.stock_batches b
    where b.store_id = v_prod.store_id and b.product_id = v_prod.id;

    select coalesce(sum((cs.set_count - cs.sold_count) * coalesce((cs.mix ->> v_prod.id::text)::integer, 0)), 0)
    into v_sets_jars
    from public.company_sets cs
    where cs.store_id = v_prod.store_id
      and cs.set_count > cs.sold_count
      and coalesce((cs.mix ->> v_prod.id::text)::integer, 0) > 0;

    if v_sets_jars > v_company_left then
      for v_cs in
        select cs.id, cs.set_count, cs.sold_count, coalesce((cs.mix ->> v_prod.id::text)::integer, 0) as per_set
        from public.company_sets cs
        where cs.store_id = v_prod.store_id
          and cs.set_count > cs.sold_count
          and coalesce((cs.mix ->> v_prod.id::text)::integer, 0) > 0
        order by cs.distribution_date desc, cs.created_at desc
      loop
        exit when v_sets_jars <= v_company_left;
        v_drop := least(v_cs.set_count - v_cs.sold_count, ceil((v_sets_jars - v_company_left)::numeric / v_cs.per_set)::integer);
        if v_drop > 0 then
          if v_cs.set_count - v_drop <= 0 then
            delete from public.company_sets where id = v_cs.id;
          else
            update public.company_sets set set_count = set_count - v_drop where id = v_cs.id;
          end if;
          v_sets_jars := v_sets_jars - v_drop * v_cs.per_set;
        end if;
      end loop;
    end if;
  end loop;
end $$;
