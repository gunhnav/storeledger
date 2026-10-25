-- =============================================================================
-- Tin báo đơn đặt trước vào Google Chat đầy đủ như hoá đơn: quán, mã đơn, ngày giờ đặt (giờ VN), người đặt (tên, domain, tầng),
-- từng dòng có đơn giá và thành tiền, tổng, hình thức thanh toán, nội dung chuyển khoản, trạng thái và link trang quản lý đơn.
-- URL webhook vẫn chỉ nằm trong Vault ('preorder_chat_webhook'), không để trong repo.
-- =============================================================================

create or replace function public.notify_preorder_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_store text;
  v_lines text;
  v_count int;
  v_text  text;
begin
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'preorder_chat_webhook' limit 1;
  if v_url is null then
    return new;
  end if;

  select s.name into v_store from public.stores s where s.id = new.store_id;

  select string_agg(
           ord || '. ' || (l ->> 'title')
           || case when l ->> 'kind' = 'set' then ' (' || (l ->> 'detail') || ')' else '' end
           || E'\n     ' || (l ->> 'qty') || ' × ' || public.preorder_money((l ->> 'unit_price')::numeric)
           || ' = *' || public.preorder_money((l ->> 'qty')::numeric * (l ->> 'unit_price')::numeric) || '*',
           E'\n' order by ord),
         sum((l ->> 'qty')::int)
  into v_lines, v_count
  from jsonb_array_elements(new.lines) with ordinality as e(l, ord);

  v_text := '🧾 *ĐƠN ĐẶT TRƯỚC MỚI — ' || coalesce(v_store, '') || '*' || E'\n'
         || 'Mã đơn: *' || new.code || '*' || E'\n'
         || '🕒 Ngày đặt: ' || to_char(new.created_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM/YYYY') || E'\n'
         || E'\n'
         || '👤 *Người đặt*' || E'\n'
         || '• Tên: ' || new.customer_name || E'\n'
         || '• Domain: ' || new.customer_domain || E'\n'
         || '• Giao tới: Tầng ' || new.floor || E'\n'
         || E'\n'
         || '🛒 *Chi tiết đơn* (' || coalesce(v_count, 0) || ' phần)' || E'\n'
         || coalesce(v_lines, '') || E'\n'
         || E'\n'
         || '💰 Tổng cộng: *' || public.preorder_money(new.total) || '*' || E'\n'
         || '💳 Thanh toán: ' || case when new.payment = 'transfer' then 'Chuyển khoản' else 'Tiền mặt khi nhận' end || E'\n'
         || case when new.payment = 'transfer'
              then '📝 Nội dung CK: ' || new.customer_domain || ' - F' || new.floor || ' (mã hoá đơn ' || new.code || ')' || E'\n'
              else '' end
         || '📌 Trạng thái: Mới — chờ xác nhận' || E'\n'
         || '🔗 Quản lý đơn: https://storeledger-one.vercel.app/entry/preorders';

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('text', v_text),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  -- Không để lỗi gửi thông báo làm hỏng việc lưu đơn; ghi cảnh báo vào log Postgres để tra
  raise warning 'notify_preorder_chat lỗi: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.notify_preorder_chat() from public, anon, authenticated;

-- Định dạng tiền kiểu VN: 50000 -> 50.000đ
create or replace function public.preorder_money(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$ select replace(to_char(round(p)::bigint, 'FM999,999,999,999'), ',', '.') || 'đ' $$;
revoke execute on function public.preorder_money(numeric) from public, anon;
