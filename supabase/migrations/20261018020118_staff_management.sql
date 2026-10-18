-- =============================================================================
-- Quản lý nhân viên: admin xem danh sách tài khoản và gỡ nhân viên khỏi cửa hàng.
-- Tạo tài khoản / đặt lại mật khẩu đi qua Edge Function admin-users (cần secret key).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- admin_list_users: mọi tài khoản kèm email và các cửa hàng đang thuộc về. Chỉ admin.
-- SECURITY DEFINER vì email nằm trong auth.users (client không đọc được).
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id               uuid,
  email            text,
  full_name        text,
  role             text,
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
    u.email::text,
    p.full_name,
    p.role,
    p.created_at,
    u.last_sign_in_at,
    coalesce(
      array_agg(m.store_id order by m.store_id) filter (where m.store_id is not null),
      '{}'
    )
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.store_members m on m.user_id = p.id
  group by p.id, u.email, u.last_sign_in_at
  order by p.role, p.full_name nulls last, u.email;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;


-- -----------------------------------------------------------------------------
-- store_members: admin được gỡ nhân viên khỏi cửa hàng
-- -----------------------------------------------------------------------------
grant delete on public.store_members to authenticated;

create policy store_members_delete_admin on public.store_members
  for delete to authenticated
  using ((select public.is_admin()));
