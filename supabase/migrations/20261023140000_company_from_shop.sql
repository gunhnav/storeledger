-- Phân phối cho công ty lấy được cả từ quán: tồn nhà + quán đều dùng được.
-- create_company_distribution: món nào thiếu ở nhà thì tự chuyển phần thiếu từ quán về nhà (create_shop_return) rồi mới
-- phân phối cho công ty, tất cả trong một giao dịch (lỗi thì không ghi gì).

create or replace function public.create_company_distribution(
  p_store_id  uuid,
  p_date      date,
  p_note      text,
  p_groups    jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group    jsonb;
  v_size     integer;
  v_count    integer;
  v_mix      jsonb;
  v_key      text;
  v_qty      integer;
  v_sum      integer;
  v_product  record;
  v_totals   jsonb := '{}'::jsonb;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_home     integer;
  v_shop     integer;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception 'Chưa có set nào';
  end if;

  -- Kiểm tra từng nhóm set và cộng tổng hũ từng vị
  for v_group in select e.value from jsonb_array_elements(p_groups) as e(value) loop
    v_size  := (v_group ->> 'size')::integer;
    v_count := (v_group ->> 'count')::integer;
    v_mix   := v_group -> 'mix';
    if v_size is null or v_size not in (4, 6) then
      raise exception 'Cỡ set chỉ nhận 4 hoặc 6';
    end if;
    if v_count is null or v_count <= 0 or v_count > 10000 then
      raise exception 'Số set phải là số nguyên > 0';
    end if;
    if v_mix is null or jsonb_typeof(v_mix) <> 'object' then
      raise exception 'Set chưa có vị nào';
    end if;

    v_sum := 0;
    for v_key, v_qty in select k, (v)::text::integer from jsonb_each(v_mix) as m(k, v) loop
      if v_qty is null or v_qty < 0 then
        raise exception 'Số hũ mỗi vị phải là số nguyên';
      end if;
      continue when v_qty = 0;
      select p.name, p.tracks_stock, p.is_active into v_product
      from public.products p
      where p.id = v_key::uuid and p.store_id = p_store_id;
      if not found then
        raise exception 'Sản phẩm % không thuộc cửa hàng này', v_key;
      end if;
      v_sum := v_sum + v_qty;
      v_totals := jsonb_set(v_totals, array[v_key], to_jsonb(coalesce((v_totals ->> v_key)::integer, 0) + v_qty * v_count));
    end loop;
    if v_sum <> v_size then
      raise exception 'Mỗi set % hũ nhưng đang chọn % hũ', v_size, v_sum;
    end if;
  end loop;

  -- Phân phối từng vị (create_transfer kiểm tra quyền, tồn ở nhà, ngày, món đếm tồn / đang bán)
  -- Thiếu hàng ở nhà thì lấy phần thiếu từ quán (chuyển quán -> nhà rồi mới phân phối cho công ty, ghi đủ cả hai bước)
  for v_key, v_qty in select k, (v)::text::integer from jsonb_each(v_totals) as t(k, v) loop
    select coalesce(sum(b.qty_home) filter (where b.received_date <= coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date)), 0),
           coalesce(sum(b.qty_shop), 0)
    into v_home, v_shop
    from public.stock_batches b
    where b.store_id = p_store_id and b.product_id = v_key::uuid;

    if v_qty > v_home then
      if v_qty - v_home > v_shop then
        select p.name into v_product from public.products p where p.id = v_key::uuid;
        raise exception 'Không đủ hàng cho "%": nhà % + quán %, cần %', v_product.name, v_home, v_shop, v_qty;
      end if;
      perform public.create_shop_return(p_store_id, v_key::uuid, v_qty - v_home, p_date, 'Lấy từ quán cho công ty');
    end if;
    perform public.create_transfer(p_store_id, v_key::uuid, v_qty, p_date, v_note, 'company');
  end loop;

  insert into public.company_sets (store_id, distribution_date, set_size, set_count, mix, note, created_by)
  select
    p_store_id,
    coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
    (e.value ->> 'size')::integer,
    (e.value ->> 'count')::integer,
    (select coalesce(jsonb_object_agg(m.k, m.v), '{}'::jsonb)
       from jsonb_each(e.value -> 'mix') as m(k, v)
      where (m.v)::text::integer > 0),
    v_note,
    auth.uid()
  from jsonb_array_elements(p_groups) as e(value);
end;
$$;
