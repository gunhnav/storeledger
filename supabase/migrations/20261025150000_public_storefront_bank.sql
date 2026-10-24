-- =============================================================================
-- Thông tin chuyển khoản hiện trên trang đặt trước công khai (QR VietQR cho khách).
--   * stores.public_bank_code: mã ngân hàng theo VietQR (VD: TCB, VCB, MB).
--   * stores.public_bank_account: số tài khoản; stores.public_bank_holder: tên chủ tài khoản.
--   * Cả ba cùng có thì get_public_menu mới trả `bank`; thiếu một trong ba thì không hiện phần chuyển khoản.
--   * Đây là thông tin chủ quán chủ động đưa cho khách nên được phép hiện công khai.
-- =============================================================================

alter table public.stores
  add column public_bank_code    text check (public_bank_code is null or public_bank_code ~ '^[A-Za-z0-9]{2,12}$'),
  add column public_bank_account text check (public_bank_account is null or public_bank_account ~ '^[0-9]{4,24}$'),
  add column public_bank_holder  text check (public_bank_holder is null or char_length(btrim(public_bank_holder)) between 2 and 60);

comment on column public.stores.public_bank_code is 'Mã ngân hàng VietQR hiện trên trang công khai (VD: TCB)';

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
  v_bank   jsonb := null;
begin
  select s.id, s.name, s.public_phone, s.public_tagline, s.public_set_price_4, s.public_set_price_6,
         s.public_bank_code, s.public_bank_account, s.public_bank_holder into v_store
  from public.stores s
  where s.code = lower(btrim(coalesce(p_store_code, ''))) and s.is_public;
  if not found then
    return null;
  end if;

  if v_store.public_bank_code is not null and v_store.public_bank_account is not null and v_store.public_bank_holder is not null then
    v_bank := jsonb_build_object('code', v_store.public_bank_code, 'account', v_store.public_bank_account, 'holder', v_store.public_bank_holder);
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
      'set_price_4', v_store.public_set_price_4, 'set_price_6', v_store.public_set_price_6, 'bank', v_bank
    ),
    'items', v_items
  );
end;
$$;

revoke execute on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;
