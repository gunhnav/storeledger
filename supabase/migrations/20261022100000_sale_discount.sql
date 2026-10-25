-- =============================================================================
-- Giảm giá / ưu đãi cho đơn bán (theo số tiền hoặc theo %), kênh Quán và Đối tác.
--   * sales: list_total (tiền hàng trước giảm), discount_type / discount_value (điều người bán nhập),
--     discount_amount (số tiền thực giảm). total_amount vẫn là số tiền khách trả (đã giảm) nên
--     mọi báo cáo doanh thu / lãi lỗ / hoa hồng giữ nguyên.
--   * create_sale_discounted: giảm đều theo tỷ lệ vào đơn giá từng dòng (làm tròn 2 số lẻ), rồi gọi
--     create_sale, nên doanh thu theo món cũng đã trừ giảm giá. Một giao dịch, lỗi thì không ghi gì.
--   * Kênh Công ty đã bán theo giá set thoả thuận nên không có giảm giá.
-- =============================================================================

alter table public.sales
  add column if not exists list_total       numeric(14,2),
  add column if not exists discount_type    text check (discount_type in ('amount', 'percent')),
  add column if not exists discount_value   numeric(14,2),
  add column if not exists discount_amount  numeric(14,2) not null default 0 check (discount_amount >= 0);

comment on column public.sales.list_total is 'Tiền hàng trước giảm giá (null nếu đơn không giảm)';
comment on column public.sales.discount_amount is 'Số tiền thực giảm; total_amount = list_total - discount_amount';

create or replace function public.create_sale_discounted(
  p_store_id         uuid,
  p_sale_date        date,
  p_channel          text,
  p_note             text,
  p_items            jsonb,
  p_discount_type    text,
  p_discount_value   numeric,
  p_commission_rate  numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item      jsonb;
  v_list      numeric := 0;
  v_discount  numeric;
  v_factor    numeric;
  v_items     jsonb := '[]'::jsonb;
  v_sale_id   uuid;
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if p_channel = 'company' then
    raise exception 'Đơn công ty bán theo giá set thoả thuận, không áp dụng giảm giá';
  end if;
  if p_discount_type is null or p_discount_type not in ('amount', 'percent') then
    raise exception 'Loại giảm giá không hợp lệ (amount hoặc percent)';
  end if;
  if p_discount_value is null or p_discount_value <= 0 then
    raise exception 'Mức giảm giá phải lớn hơn 0';
  end if;
  if p_discount_type = 'percent' and p_discount_value > 100 then
    raise exception 'Giảm giá theo phần trăm tối đa 100%%';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Đơn bán phải có ít nhất một món';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    v_list := v_list + (v_item ->> 'quantity')::integer * round((v_item ->> 'unit_price')::numeric, 2);
  end loop;
  if v_list <= 0 then
    raise exception 'Đơn không có tiền hàng để giảm giá';
  end if;

  v_discount := case p_discount_type
    when 'amount' then round(p_discount_value)
    else round(v_list * p_discount_value / 100)
  end;
  if v_discount <= 0 then
    raise exception 'Mức giảm giá quá nhỏ';
  end if;
  if v_discount > v_list then
    raise exception 'Giảm giá (%) lớn hơn tiền hàng (%)', v_discount, v_list;
  end if;

  -- Giảm đều theo tỷ lệ vào đơn giá từng dòng
  v_factor := (v_list - v_discount) / v_list;
  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    v_items := v_items || jsonb_build_array(
      jsonb_set(v_item, '{unit_price}', to_jsonb(round(round((v_item ->> 'unit_price')::numeric, 2) * v_factor, 2)))
    );
  end loop;

  v_sale_id := public.create_sale(p_store_id, p_sale_date, p_channel, p_note, v_items, p_commission_rate);

  update public.sales s
  set list_total      = v_list,
      discount_type   = p_discount_type,
      discount_value  = p_discount_value,
      discount_amount = greatest(v_list - s.total_amount, 0)
  where s.id = v_sale_id;

  return v_sale_id;
end;
$$;

revoke execute on function public.create_sale_discounted(uuid, date, text, text, jsonb, text, numeric, numeric) from public, anon;
grant execute on function public.create_sale_discounted(uuid, date, text, text, jsonb, text, numeric, numeric) to authenticated;
