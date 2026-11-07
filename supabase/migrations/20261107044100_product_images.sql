-- Ảnh món cho trang đặt hàng công khai (/hogi, /shop/<mã quán>)
-- - products.image_url: URL công khai của ảnh trong bucket product-images (null = dùng ảnh tĩnh mặc định theo tên món)
-- - products.image_x / image_y: điểm căn (0..100 %) như object-position; image_zoom: độ phóng 1..3
--   null = dùng căn mặc định theo tên món. Ảnh gốc giữ nguyên, căn chỉnh lại lúc nào cũng được.
-- - Chỉ admin (public.is_admin()) được tải lên / xoá ảnh; ai cũng xem được ảnh qua URL công khai.

alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists image_x numeric(5, 2);
alter table public.products add column if not exists image_y numeric(5, 2);
alter table public.products add column if not exists image_zoom numeric(4, 2);

alter table public.products drop constraint if exists products_image_url_check;
alter table public.products add constraint products_image_url_check
  check (image_url is null or (char_length(image_url) <= 500 and image_url ~ '^https://'));
alter table public.products drop constraint if exists products_image_frame_check;
alter table public.products add constraint products_image_frame_check
  check (
    (image_x is null or image_x between 0 and 100)
    and (image_y is null or image_y between 0 and 100)
    and (image_zoom is null or image_zoom between 1 and 3)
  );

-- Bucket công khai: đọc qua URL public, giới hạn 2MB / ảnh (frontend đã nén WebP ~100KB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Quyền ghi: chỉ admin đã duyệt. SELECT cần cho remove() (xoá ảnh cũ) và liệt kê; ảnh vẫn xem được qua URL public.
drop policy if exists product_images_select_admin on storage.objects;
create policy product_images_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

drop policy if exists product_images_insert_admin on storage.objects;
create policy product_images_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_admin()));

drop policy if exists product_images_update_admin on storage.objects;
create policy product_images_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()))
  with check (bucket_id = 'product-images' and (select public.is_admin()));

drop policy if exists product_images_delete_admin on storage.objects;
create policy product_images_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

-- get_public_menu trả thêm ảnh + căn chỉnh của từng món (giữ nguyên phần còn lại của 20261106020000)
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
      p.image_url,
      p.image_x,
      p.image_y,
      p.image_zoom,
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
