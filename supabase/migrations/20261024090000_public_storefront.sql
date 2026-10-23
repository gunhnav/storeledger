-- =============================================================================
-- Trang bán hàng công khai (/hogi, /shop/<mã quán>): khách không cần đăng nhập xem thực đơn, giá và tình trạng hàng.
--   * stores.is_public: chỉ quán bật cờ này mới có trang công khai (mặc định tắt; bật cho Hogi).
--   * stores.public_phone / public_tagline: số Zalo / hotline và câu giới thiệu hiện trên trang (để trống thì ẩn).
--   * get_public_menu(p_store_code): trả tên quán, thực đơn đang bán (tên, nhóm, giá bán hiện hành) và TÌNH TRẠNG hàng
--     (in_stock / low / out). Không trả số lượng cụ thể, giá vốn, giá đối tác hay bất kỳ số liệu nội bộ nào.
--     Còn hàng = tồn ở nhà + ở quán (hàng đã phân phối cho công ty không tính). Món không đếm tồn luôn "in_stock".
-- =============================================================================

alter table public.stores
  add column is_public      boolean not null default false,
  add column public_phone   text,
  add column public_tagline text;

comment on column public.stores.is_public is 'Bật trang bán hàng công khai /shop/<code>';
comment on column public.stores.public_phone is 'Số Zalo / hotline hiện trên trang công khai';

update public.stores set is_public = true where code = 'hogi';

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
  select s.id, s.name, s.public_phone, s.public_tagline into v_store
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
        order by pp.effective_from desc limit 1) as price,
      case
        when not p.tracks_stock then 'in_stock'
        when coalesce(b.avail, 0) <= 0 then 'out'
        when coalesce(b.avail, 0) <= p.low_stock_threshold then 'low'
        else 'in_stock'
      end as status
    from public.products p
    left join (
      select sb.product_id, sum(sb.qty_home + sb.qty_shop) as avail
      from public.stock_batches sb
      where sb.store_id = v_store.id
      group by sb.product_id
    ) b on b.product_id = p.id
    where p.store_id = v_store.id and p.is_active
  ) i;

  return jsonb_build_object(
    'store', jsonb_build_object('name', v_store.name, 'phone', v_store.public_phone, 'tagline', v_store.public_tagline),
    'items', v_items
  );
end;
$$;

revoke execute on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;
