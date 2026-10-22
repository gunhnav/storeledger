-- Giảm giá cho đơn Công ty: create_company_sale nhận thêm loại / mức giảm và tiền hàng trước giảm.
-- p_items là giá đã giảm (client chia đều qua allocateSetTotal); hàm kiểm tra tổng khớp (lệch tối đa 1 đồng do làm tròn)
-- rồi ghi list_total / discount_* vào đơn. Bỏ bản cũ để không bị trùng tên hàm.
drop function public.create_company_sale(uuid, date, text, jsonb, jsonb);

create or replace function public.create_company_sale(
  p_store_id   uuid,
  p_sale_date  date,
  p_note       text,
  p_items      jsonb,
  p_sets       jsonb,
  p_discount_type   text default null,
  p_discount_value  numeric default null,
  p_list_total      numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pick    jsonb;
  v_need    integer;
  v_row     record;
  v_take    integer;
  v_sale_id uuid;
  v_discount numeric;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'Chưa chọn set nào để bán';
  end if;

  for v_pick in select e.value from jsonb_array_elements(p_sets) as e(value) loop
    v_need := (v_pick ->> 'count')::integer;
    if v_need is null or v_need <= 0 then
      raise exception 'Số set phải là số nguyên > 0';
    end if;
    -- Trừ vào các nhóm cùng cỡ + cùng thành phần, nhóm phân phối cũ trước
    for v_row in
      select cs.id, cs.set_count - cs.sold_count as remaining
      from public.company_sets cs
      where cs.store_id = p_store_id
        and cs.set_size = (v_pick ->> 'size')::integer
        and cs.mix = (v_pick -> 'mix')
        and cs.set_count > cs.sold_count
      order by cs.distribution_date, cs.created_at
      for update
    loop
      exit when v_need = 0;
      v_take := least(v_need, v_row.remaining);
      update public.company_sets set sold_count = sold_count + v_take where id = v_row.id;
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception 'Không đủ set để bán (thiếu % set)', v_need;
    end if;
  end loop;

  v_sale_id := public.create_sale(p_store_id, p_sale_date, 'company', p_note, p_items);

  -- Giảm giá: p_items đã là giá sau giảm (client chia đều); ở đây kiểm tra lại rồi ghi lại thông tin giảm giá
  if p_discount_type is not null then
    if p_discount_type not in ('amount', 'percent') or p_discount_value is null or p_discount_value <= 0
       or p_list_total is null or p_list_total <= 0 then
      raise exception 'Thông tin giảm giá không hợp lệ';
    end if;
    if p_discount_type = 'percent' and p_discount_value > 100 then
      raise exception 'Giảm giá theo phần trăm tối đa 100%%';
    end if;
    v_discount := case p_discount_type when 'amount' then round(p_discount_value) else round(p_list_total * p_discount_value / 100) end;
    if v_discount <= 0 or v_discount > p_list_total then
      raise exception 'Giảm giá không hợp lệ (giảm %, tiền hàng %)', v_discount, p_list_total;
    end if;
    update public.sales s
    set list_total = p_list_total, discount_type = p_discount_type, discount_value = p_discount_value, discount_amount = v_discount
    where s.id = v_sale_id
      and abs(s.total_amount - (p_list_total - v_discount)) <= 1;
    if not found then
      raise exception 'Tổng tiền đơn không khớp với giảm giá, thử lại';
    end if;
  end if;

  return v_sale_id;
end;
$$;

revoke execute on function public.create_company_sale(uuid, date, text, jsonb, jsonb, text, numeric, numeric) from public, anon;
grant execute on function public.create_company_sale(uuid, date, text, jsonb, jsonb, text, numeric, numeric) to authenticated;
