-- =============================================================================
-- Thông báo đơn đặt trước vào Google Chat:
--   * Người đặt: Chỉ hiển thị Domain (bỏ hoàn toàn phần Tên vì khách không đăng nhập,
--     không thể fetch tên thật từ Google Directory nên dùng domain làm tên gây thừa thông tin).
--   * Chi tiết đơn: Gọn 1 dòng, không lặp lại phép tính đơn lẻ.
-- =============================================================================

create or replace function public.notify_preorder_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url         text;
  v_store       text;
  v_lines       text;
  v_count       int;
  v_text        text;
  v_who         text;
  v_post        text;
  v_total_lines int;
begin
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'preorder_chat_webhook' limit 1;
  if v_url is null then
    return new;
  end if;

  -- Mỗi đơn là một luồng (thread) riêng trong space, khoá theo mã đơn: tin đơn mới mở luồng, các lần đổi trạng thái trả lời vào luồng đó
  v_post := v_url || case when v_url like '%?%' then '&' else '?' end
            || 'threadKey=' || new.code || '&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';

  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return new;
    end if;
    select coalesce(nullif(btrim(p.full_name), ''), 'quản trị') into v_who from public.profiles p where p.id = auth.uid();
    v_text := case new.status
                when 'confirmed' then '✅ *ĐÃ NHẬN ĐƠN* '
                when 'paid'      then '💵 *ĐÃ THANH TOÁN* '
                when 'delivered' then '📦 *ĐÃ GIAO* '
                when 'cancelled' then '❌ *ĐÃ HUỶ* '
                else '🆕 *CHƯA NHẬN* '
              end
              || new.code || ' — ' || new.customer_domain || ' · Tầng ' || new.floor || E'\n'
              || '🕒 ' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM/YYYY')
              || ' · bởi ' || coalesce(v_who, 'quản trị');
    perform net.http_post(url := v_post, body := jsonb_build_object('text', v_text), headers := '{"Content-Type": "application/json"}'::jsonb);
    return new;
  end if;

  select s.name into v_store from public.stores s where s.id = new.store_id;

  v_total_lines := coalesce(jsonb_array_length(new.lines), 0);

  select string_agg(
           case
             when v_total_lines = 1 then '• '
             else ord || '. '
           end
           || (l ->> 'qty') || ' × ' || (l ->> 'title')
           || case when l ->> 'kind' = 'set' and coalesce(l ->> 'detail', '') <> '' then ' (' || (l ->> 'detail') || ')' else '' end
           || case
                when v_total_lines = 1 then
                  case
                    when (l ->> 'qty')::int > 1 then ' · ' || public.preorder_money((l ->> 'unit_price')::numeric) || '/phần'
                    else ''
                  end
                else ' · ' || public.preorder_money((l ->> 'qty')::numeric * (l ->> 'unit_price')::numeric)
              end,
           E'\n' order by ord),
         sum((l ->> 'qty')::int)
  into v_lines, v_count
  from jsonb_array_elements(new.lines) with ordinality as e(l, ord);

  v_text := '🧾 *ĐƠN ĐẶT TRƯỚC MỚI — ' || coalesce(v_store, '') || '*' || E'\n'
         || 'Mã đơn: *' || new.code || '*' || E'\n'
         || '🕒 Ngày đặt: ' || to_char(new.created_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM/YYYY') || E'\n'
         || E'\n'
         || '👤 *Người đặt*' || E'\n'
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
         || '📌 Trạng thái: 🆕 *CHƯA NHẬN* — bấm "Nhận đơn" trong trang quản lý' || E'\n'
         || '🔗 Quản lý đơn: https://storeledger-one.vercel.app/entry/preorders';

  perform net.http_post(
    url := v_post,
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

drop trigger if exists preorders_notify_chat on public.preorders;
create trigger preorders_notify_chat after insert or update of status on public.preorders
  for each row execute function public.notify_preorder_chat();
