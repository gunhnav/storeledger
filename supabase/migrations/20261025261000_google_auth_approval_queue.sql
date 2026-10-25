-- =============================================================================
-- Migration: Hỗ trợ Google Login, tài khoản Master Admin và Hàng chờ phê duyệt
-- Master Admin: cấu hình qua Supabase Vault (tên: 'master_admin_email') để bảo mật,
-- KHÔNG lưu email cá nhân trong mã nguồn public repo.
-- =============================================================================

-- 1. Thêm cột status vào profiles (pending: chờ duyệt, approved: đã duyệt, rejected: từ chối)
alter table public.profiles
  add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));

-- Thêm cột email vào profiles để lưu vết email đăng nhập OAuth
alter table public.profiles
  add column if not exists email text;

-- Cập nhật email cho các profile hiện có từ auth.users
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Tự động cấp quyền Master Admin nếu email khớp với Vault secret 'master_admin_email'
do $$
declare
  v_master_email text;
begin
  select lower(ds.decrypted_secret) into v_master_email
  from vault.decrypted_secrets ds
  where ds.name = 'master_admin_email'
  limit 1;

  if v_master_email is not null and v_master_email <> '' then
    update public.profiles p
    set role = 'admin', status = 'approved'
    from auth.users u
    where p.id = u.id and lower(coalesce(u.email, '')) = v_master_email;
  end if;
exception when others then
  null;
end $$;

-- 2. Trigger tự động tạo profile khi có user mới đăng nhập qua Google OAuth / Email
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_master_email text;
  v_is_master boolean := false;
  v_full_name text;
begin
  v_email := lower(coalesce(new.email, ''));

  -- Lấy Master Admin email từ Supabase Vault (mã hoá, bảo mật, không lộ trong repo)
  begin
    select lower(ds.decrypted_secret) into v_master_email
    from vault.decrypted_secrets ds
    where ds.name = 'master_admin_email'
    limit 1;
  exception when others then
    v_master_email := null;
  end;

  if v_master_email is null or v_master_email = '' then
    v_master_email := lower(coalesce(nullif(current_setting('app.settings.master_admin_email', true), ''), ''));
  end if;

  if v_master_email is not null and v_master_email <> '' then
    v_is_master := (v_email = v_master_email);
  end if;

  -- Nếu hệ thống chưa từng có admin nào thì tài khoản đầu tiên đăng nhập tự động thành admin
  if not v_is_master and not exists (select 1 from public.profiles where role = 'admin' and status = 'approved') then
    v_is_master := true;
  end if;

  v_full_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(v_email, '@', 1)
  );

  insert into public.profiles (id, full_name, email, role, status)
  values (
    new.id,
    v_full_name,
    new.email,
    case when v_is_master then 'admin' else 'staff' end,
    case when v_is_master then 'approved' else 'pending' end
  )
  on conflict (id) do update set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    email = coalesce(public.profiles.email, excluded.email),
    role = case when v_is_master then 'admin' else public.profiles.role end,
    status = case when v_is_master then 'approved' else public.profiles.status end;

  return new;
end;
$$;

-- 3. Cập nhật hàm is_admin() kiểm tra cả role = 'admin' và status = 'approved'
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select (p.role = 'admin' and p.status = 'approved')
     from public.profiles p
     where p.id = auth.uid()),
    false
  );
$$;

-- 4. Cập nhật hàm can_access_store(p_store_id) chỉ cho phép tài khoản đã được approved
create or replace function public.can_access_store(p_store_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (
    public.is_admin()
    or exists (
      select 1
      from public.profiles p
      join public.store_members sm on sm.user_id = p.id
      where p.id = auth.uid()
        and p.status = 'approved'
        and sm.store_id = p_store_id
    )
  );
$$;

-- 5. Cập nhật hàm admin_list_users() trả về thêm status và sắp xếp pending lên đầu
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id               uuid,
  email            text,
  full_name        text,
  role             text,
  status           text,
  created_at       timestamptz,
  last_sign_in_at  timestamptz,
  store_ids        uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xem danh sách nhân viên' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    coalesce(u.email::text, p.email),
    p.full_name,
    p.role,
    coalesce(p.status, 'approved'),
    p.created_at,
    u.last_sign_in_at,
    coalesce(
      array_agg(m.store_id order by m.store_id) filter (where m.store_id is not null),
      '{}'
    )
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.store_members m on m.user_id = p.id
  group by p.id, u.email, p.email, p.status, u.last_sign_in_at
  order by
    case when coalesce(p.status, 'approved') = 'pending' then 0 else 1 end,
    p.role,
    p.full_name nulls last,
    u.email;
end;
$$;

-- 6. Hàm admin_approve_user: Admin duyệt tài khoản, phân quyền và gán cửa hàng
create or replace function public.admin_approve_user(
  p_user_id uuid,
  p_role text default 'staff',
  p_store_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được duyệt tài khoản' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'staff') then
    raise exception 'Vai trò không hợp lệ';
  end if;

  update public.profiles
  set status = 'approved',
      role = p_role
  where id = p_user_id;

  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;

  -- Cập nhật quyền truy cập cửa hàng
  delete from public.store_members where user_id = p_user_id;
  if p_role = 'staff' and p_store_ids is not null then
    foreach v_store_id in array p_store_ids loop
      insert into public.store_members (store_id, user_id)
      values (v_store_id, p_user_id)
      on conflict do nothing;
    end loop;
  end if;
end;
$$;

revoke execute on function public.admin_approve_user(uuid, text, uuid[]) from public, anon;
grant execute on function public.admin_approve_user(uuid, text, uuid[]) to authenticated;

-- 7. Hàm admin_reject_user: Admin từ chối hoặc thu hồi quyền tài khoản
create or replace function public.admin_reject_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_master_email text;
  v_target_email text;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được từ chối tài khoản' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Không thể từ chối tài khoản của chính mình';
  end if;

  -- Kiểm tra không thể từ chối tài khoản Master Admin cấu hình trong Vault
  begin
    select lower(ds.decrypted_secret) into v_master_email
    from vault.decrypted_secrets ds
    where ds.name = 'master_admin_email'
    limit 1;
  exception when others then
    v_master_email := null;
  end;

  if v_master_email is not null and v_master_email <> '' then
    select lower(coalesce(email, '')) into v_target_email from public.profiles where id = p_user_id;
    if v_target_email = v_master_email then
      raise exception 'Không thể từ chối tài khoản Master Admin';
    end if;
  end if;

  delete from public.store_members where user_id = p_user_id;

  update public.profiles
  set status = 'rejected'
  where id = p_user_id;

  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;
end;
$$;

revoke execute on function public.admin_reject_user(uuid) from public, anon;
grant execute on function public.admin_reject_user(uuid) to authenticated;
