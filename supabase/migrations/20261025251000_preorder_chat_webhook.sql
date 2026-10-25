-- =============================================================================
-- Báo đơn đặt trước mới vào một space Google Chat (Hangout) qua incoming webhook.
--   * URL webhook là bí mật: lưu trong Supabase Vault với tên 'preorder_chat_webhook' (tạo bằng vault.create_secret, KHÔNG để trong
--     repo vì repo công khai). Chưa có secret thì trigger không làm gì.
--   * Gửi bằng pg_net (bất đồng bộ): lỗi mạng / webhook không làm hỏng việc khách đặt đơn.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_preorder_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_lines text;
  v_text  text;
  v_money text := replace(to_char(new.total::bigint, 'FM999,999,999,999'), ',', '.') || 'đ';
begin
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'preorder_chat_webhook' limit 1;
  if v_url is null then
    return new;
  end if;

  select string_agg(
           '• ' || (l ->> 'qty') || ' × ' || (l ->> 'title')
           || case when l ->> 'kind' = 'set' then ' (' || (l ->> 'detail') || ')' else '' end,
           E'\n')
  into v_lines
  from jsonb_array_elements(new.lines) as e(l);

  v_text := '🧾 Đơn đặt trước mới *' || new.code || '*' || E'\n'
         || '👤 ' || new.customer_name || ' · ' || new.customer_domain || ' · Tầng ' || new.floor || E'\n'
         || coalesce(v_lines, '') || E'\n'
         || '💰 Tổng: *' || v_money || '* · ' || case when new.payment = 'transfer' then 'Chuyển khoản' else 'Tiền mặt khi nhận' end;

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

drop trigger if exists preorders_notify_chat on public.preorders;
create trigger preorders_notify_chat after insert on public.preorders
  for each row execute function public.notify_preorder_chat();
