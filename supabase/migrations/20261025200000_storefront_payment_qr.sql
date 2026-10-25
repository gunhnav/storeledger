-- =============================================================================
-- QR thanh toán gốc của quán (chuỗi EMVCo / VietQR, ví dụ QR "Góp Quỹ" MoMo) cho trang đặt trước.
--   * stores.public_qr_payload: chuỗi QR gốc bắt đầu bằng 000201 (trang khách tự thêm số tiền, số hoá đơn, nội dung).
--   * stores.public_qr_label: tên ví / ngân hàng hiện cho khách (VD: MoMo). Tên người nhận dùng public_bank_holder.
--   * get_public_menu trả store.pay = { payload, label, holder } khi có đủ chuỗi QR và tên người nhận.
-- =============================================================================

alter table public.stores
  add column if not exists public_qr_payload text check (public_qr_payload is null or (public_qr_payload ~ '^000201' and char_length(public_qr_payload) <= 512)),
  add column if not exists public_qr_label   text check (public_qr_label is null or char_length(btrim(public_qr_label)) between 1 and 40);

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
  select s.id, s.name, s.public_phone, s.public_tagline,
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
      case when p.category is null then 1 else 0 end as sort_group,
      (select pp.sale_price from public.product_prices pp
        where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
        order by pp.effective_from desc limit 1) as price
    from public.products p
    where p.store_id = v_store.id and p.is_active
  ) i;

  select coalesce(jsonb_agg(jsonb_build_object('size', r.set_size, 'product_id', r.product_id, 'price', r.price) order by r.set_size, r.product_id nulls last), '[]'::jsonb)
  into v_prices
  from public.storefront_set_prices r
  where r.store_id = v_store.id;

  return jsonb_build_object(
    'store', jsonb_build_object('name', v_store.name, 'phone', v_store.public_phone, 'tagline', v_store.public_tagline,
                                'bank', v_bank, 'pay', v_pay, 'set_prices', v_prices),
    'items', v_items
  );
end;
$$;

revoke execute on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;
