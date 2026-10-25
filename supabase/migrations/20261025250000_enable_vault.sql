-- Kích hoạt extension Supabase Vault để lưu trữ bí mật mã hoá (pgsodium/TDE) trong Postgres
create extension if not exists supabase_vault with schema vault;

-- Đảm bảo quyền truy cập vault được bảo vệ chặt chẽ:
-- Chỉ có role postgres và service_role mới được truy cập trực tiếp schema vault.
-- Người dùng anon và authenticated bị chặn hoàn toàn, không thể đọc vault.
revoke all on schema vault from public, anon, authenticated;
grant usage on schema vault to postgres, service_role;

revoke all on all tables in schema vault from public, anon, authenticated;
grant select on all tables in schema vault to postgres, service_role;

-- Hàm mẫu an toàn để đọc secret từ Vault bên trong database (chỉ admin / security definer được gọi)
create or replace function public.get_vault_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_secret text;
begin
  -- Chỉ cho phép user đã đăng nhập là admin đọc secret nội bộ
  if not public.is_admin() then
    raise exception 'Chỉ quản trị viên mới có quyền đọc secret từ Vault';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = p_name;

  return v_secret;
end;
$$;

comment on function public.get_vault_secret(text) is 'Đọc bí mật đã giải mã từ Supabase Vault theo tên. Yêu cầu quyền admin.';

-- Hàm an toàn để lưu / cập nhật secret vào Vault (chỉ admin được gọi)
create or replace function public.admin_set_vault_secret(p_name text, p_secret text)
returns void
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_secret_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Chỉ quản trị viên mới có quyền cấu hình Vault' using errcode = '42501';
  end if;

  select id into v_secret_id from vault.secrets where name = p_name limit 1;

  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, p_secret);
  else
    perform vault.create_secret(p_secret, p_name);
  end if;
end;
$$;

revoke execute on function public.admin_set_vault_secret(text, text) from public, anon;
grant execute on function public.admin_set_vault_secret(text, text) to authenticated;
comment on function public.admin_set_vault_secret(text, text) is 'Lưu hoặc cập nhật bí mật mã hoá vào Supabase Vault theo tên. Yêu cầu quyền admin.';
