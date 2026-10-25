-- =============================================================================
-- Liên hệ quán qua Google Chat: link hội thoại và email hiện trên trang khách.
--   * stores.public_chat_url: link Google Chat mở thẳng hội thoại với quán (https://chat.google.com/...).
--   * stores.public_contact_email: email hiện cho khách tìm trên Google Chat.
-- Giá trị cụ thể nhập trong app / DB, KHÔNG để trong repo.
-- =============================================================================

alter table public.stores
  add column if not exists public_chat_url text check (public_chat_url is null or public_chat_url ~ '^https://chat\.google\.com/'),
  add column if not exists public_contact_email text check (public_contact_email is null or public_contact_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

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

  select coalesce(jsonb_agg(jsonb_build_object('size', r.set_size, 'product_id', r.product_id, 'price', r.price) order by r.set_size, r.product_id nulls last), '[]'::jsonb)
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
