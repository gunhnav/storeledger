-- =============================================================================
-- Migration: Phân quyền Super Admin cấp cao nhất và gán cho hungng28900@gmail.com
-- =============================================================================

-- 1. Cập nhật ràng buộc check constraint trên cột role của profiles
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'staff'));

-- 2. Hàm kiểm tra is_super_admin()
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select (p.role = 'super_admin' and p.status = 'approved')
     from public.profiles p
     where p.id = auth.uid()),
    false
  );
$$;

revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- 3. Cập nhật hàm is_admin() để cả super_admin và admin đều được tính là admin trong các chính sách RLS
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select (p.role in ('super_admin', 'admin') and p.status = 'approved')
     from public.profiles p
     where p.id = auth.uid()),
    false
  );
$$;

-- 4. Tự động cấp quyền Super Admin cho hungng28900@gmail.com nếu tài khoản đã tồn tại
update public.profiles
set role = 'super_admin', status = 'approved'
where lower(coalesce(email, '')) = 'hungng28900@gmail.com'
   or id in (select id from auth.users where lower(email) = 'hungng28900@gmail.com');

-- 5. Cập nhật trigger handle_new_user() tự động gán super_admin cho hungng28900@gmail.com
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_master_email text;
  v_is_super boolean := false;
  v_is_master boolean := false;
  v_full_name text;
begin
  v_email := lower(coalesce(new.email, ''));

  -- Email super admin cấp cao nhất
  if v_email = 'hungng28900@gmail.com' then
    v_is_super := true;
  end if;

  -- Master admin email từ Vault hoặc cài đặt
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

  if v_master_email is not null and v_master_email <> '' and v_email = v_master_email then
    v_is_master := true;
  end if;

  -- Nếu hệ thống chưa từng có admin/super_admin nào thì tài khoản đầu tiên là admin
  if not v_is_super and not v_is_master and not exists (
    select 1 from public.profiles where role in ('super_admin', 'admin') and status = 'approved'
  ) then
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
    case when v_is_super then 'super_admin' when v_is_master then 'admin' else 'staff' end,
    case when v_is_super or v_is_master then 'approved' else 'pending' end
  )
  on conflict (id) do update set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    email = coalesce(public.profiles.email, excluded.email),
    role = case when v_is_super then 'super_admin' when v_is_master and public.profiles.role <> 'super_admin' then 'admin' else public.profiles.role end,
    status = case when v_is_super or v_is_master then 'approved' else public.profiles.status end;

  return new;
end;
$$;

-- 6. Cập nhật admin_list_users() sắp xếp super_admin lên trước
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
    case p.role when 'super_admin' then 0 when 'admin' then 1 else 2 end,
    p.full_name nulls last,
    u.email;
end;
$$;

-- 7. Cập nhật admin_set_role(p_user_id uuid, p_role text)
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_email text;
  v_target_role text;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin hoặc super admin được quản lý vai trò' using errcode = '42501';
  end if;

  if p_role not in ('super_admin', 'admin', 'staff') then
    raise exception 'Vai trò không hợp lệ';
  end if;

  -- Chỉ super_admin mới được phong quyền super_admin
  if p_role = 'super_admin' and not public.is_super_admin() then
    raise exception 'Chỉ Super Admin mới được cấp quyền Super Admin';
  end if;

  select lower(coalesce(email, '')), role into v_target_email, v_target_role
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;

  -- Không ai được hạ quyền của hungng28900@gmail.com
  if v_target_email = 'hungng28900@gmail.com' and p_role <> 'super_admin' then
    raise exception 'Không thể thay đổi quyền của Super Admin chính';
  end if;

  -- Admin thường không được can thiệp vào tài khoản super_admin
  if v_target_role = 'super_admin' and not public.is_super_admin() then
    raise exception 'Chỉ Super Admin mới được thay đổi quyền của Super Admin khác';
  end if;

  if p_role = 'staff' and p_user_id = auth.uid() then
    raise exception 'Không thể tự bỏ quyền quản trị của chính mình';
  end if;

  -- Đảm bảo luôn còn ít nhất 1 admin hoặc super_admin
  perform 1 from public.profiles where role in ('super_admin', 'admin') for update;
  if p_role = 'staff'
     and (select count(*) from public.profiles where role in ('super_admin', 'admin') and id <> p_user_id) = 0 then
    raise exception 'Phải còn ít nhất một quản trị viên';
  end if;

  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

-- 8. Cập nhật admin_approve_user
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
  if p_role not in ('super_admin', 'admin', 'staff') then
    raise exception 'Vai trò không hợp lệ';
  end if;

  if p_role = 'super_admin' and not public.is_super_admin() then
    raise exception 'Chỉ Super Admin mới được duyệt quyền Super Admin';
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

-- 9. Cập nhật admin_reject_user
create or replace function public.admin_reject_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_master_email text;
  v_target_email text;
  v_target_role text;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được từ chối tài khoản' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Không thể từ chối tài khoản của chính mình';
  end if;

  select lower(coalesce(email, '')), role into v_target_email, v_target_role
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;

  -- Bảo vệ Super Admin
  if v_target_email = 'hungng28900@gmail.com' or v_target_role = 'super_admin' then
    raise exception 'Không thể từ chối tài khoản Super Admin';
  end if;

  -- Kiểm tra Master Admin trong Vault
  begin
    select lower(ds.decrypted_secret) into v_master_email
    from vault.decrypted_secrets ds
    where ds.name = 'master_admin_email'
    limit 1;
  exception when others then
    v_master_email := null;
  end;

  if v_master_email is not null and v_master_email <> '' and v_target_email = v_master_email then
    raise exception 'Không thể từ chối tài khoản Master Admin';
  end if;

  delete from public.store_members where user_id = p_user_id;

  update public.profiles
  set status = 'rejected'
  where id = p_user_id;
end;
$$;
