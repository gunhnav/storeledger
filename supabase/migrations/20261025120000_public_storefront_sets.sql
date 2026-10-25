-- =============================================================================
-- Trang bán hàng công khai chuyển sang ĐẶT TRƯỚC theo SET (4 hoặc 6 hũ, tự chọn vị), giống kênh Công ty.
--   * Không còn lấy tồn kho: ai đặt gì nhận đó, nên get_public_menu không trả tình trạng còn / hết nữa
--     (cũng không lộ thêm bất kỳ số liệu kho nào ra ngoài).
--   * stores.public_set_price_4 / public_set_price_6: giá một set cỡ 4 / 6 hũ. Để trống thì giá set = tổng giá từng hũ.
-- =============================================================================

alter table public.stores
  add column if not exists public_set_price_4 numeric(12,2) check (public_set_price_4 is null or public_set_price_4 > 0),
  add column if not exists public_set_price_6 numeric(12,2) check (public_set_price_6 is null or public_set_price_6 > 0);

comment on column public.stores.public_set_price_4 is 'Giá 1 set 4 hũ trên trang công khai (trống = cộng giá từng hũ)';
comment on column public.stores.public_set_price_6 is 'Giá 1 set 6 hũ trên trang công khai (trống = cộng giá từng hũ)';

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
begin
  select s.id, s.name, s.public_phone, s.public_tagline, s.public_set_price_4, s.public_set_price_6 into v_store
  from public.stores s
  where s.code = lower(btrim(coalesce(p_store_code, ''))) and s.is_public;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(i order by i.sort_group, i.name), '[]'::jsonb) into v_items
  from (
    select
      p.id,
      p.name,
      p.category,
      case when p.category is null then 1 else 0 end as sort_group,
      (select pp.sale_price from public.product_prices pp
        where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
        order by pp.effective_from desc limit 1) as price
    from public.products p
    where p.store_id = v_store.id and p.is_active
  ) i;

  return jsonb_build_object(
    'store', jsonb_build_object(
      'name', v_store.name, 'phone', v_store.public_phone, 'tagline', v_store.public_tagline,
      'set_price_4', v_store.public_set_price_4, 'set_price_6', v_store.public_set_price_6
    ),
    'items', v_items
  );
end;
$$;

revoke execute on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;
