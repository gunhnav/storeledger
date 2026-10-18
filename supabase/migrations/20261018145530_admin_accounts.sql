-- =============================================================================
-- admin_set_full_name — Admin đổi tên hiển thị của một tài khoản.
--   * Edge Function admin-users trước đây ghi profiles bằng service_role, nhưng service_role
--     của project không có quyền ghi bảng public → lỗi "permission denied".
--   * Không cấp thêm quyền bảng cho role nào; ghi qua hàm SECURITY DEFINER, tự kiểm tra is_admin().
-- =============================================================================

create or replace function public.admin_set_full_name(p_user_id uuid, p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được quản lý tài khoản';
  end if;
  if v_name = '' then
    raise exception 'Nhập tên nhân viên';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'Tên tối đa 100 ký tự';
  end if;

  update public.profiles set full_name = v_name where id = p_user_id;
  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;
end;
$$;

revoke execute on function public.admin_set_full_name(uuid, text) from public, anon;
grant execute on function public.admin_set_full_name(uuid, text) to authenticated;

-- =============================================================================
-- admin_set_role — Admin cấp / thu hồi quyền admin cho một tài khoản.
--   * Không tự hạ quyền chính mình, không để hệ thống còn 0 admin (tránh bị khoá ngoài).
--   * Admin thấy mọi cửa hàng theo role nên không cần dòng store_members; khi hạ về staff,
--     tài khoản giữ các cửa hàng đã gán trước đó (nếu có), admin gán thêm ở trang Nhân viên.
-- =============================================================================

create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được quản lý tài khoản';
  end if;
  if p_role not in ('admin', 'staff') then
    raise exception 'Vai trò không hợp lệ';
  end if;
  if p_role = 'staff' and p_user_id = (select auth.uid()) then
    raise exception 'Không thể tự bỏ quyền admin của chính mình';
  end if;

  -- Khoá các dòng admin để hai lần hạ quyền cùng lúc không làm mất admin cuối cùng
  perform 1 from public.profiles where role = 'admin' for update;
  if p_role = 'staff'
     and (select count(*) from public.profiles where role = 'admin' and id <> p_user_id) = 0 then
    raise exception 'Phải còn ít nhất một admin';
  end if;

  update public.profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;
end;
$$;

revoke execute on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
