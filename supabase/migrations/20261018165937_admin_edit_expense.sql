-- =============================================================================
-- admin_edit_expense — Admin sửa / xoá một khoản chi phí.
--   * Không cấp quyền update / delete bảng expenses cho role nào, không đổi RLS:
--     ghi qua hàm SECURITY DEFINER, tự kiểm tra is_admin().
--   * Ràng buộc sẵn có của bảng (nhóm theo danh sách, số lượng, đơn giá, thành tiền) vẫn áp dụng.
--   * Thành tiền (amount) do app tính như khi thêm: số lượng × đơn giá hoặc số ghi đè.
-- =============================================================================

create or replace function public.update_expense(
  p_expense_id    uuid,
  p_expense_date  date,
  p_category      text,
  p_note          text,
  p_quantity      numeric,
  p_unit_price    numeric,
  p_amount        numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa chi phí' using errcode = '42501';
  end if;
  if p_expense_date is null or p_expense_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được ghi ngày trong tương lai (%)', p_expense_date;
  end if;
  if p_category is null or p_category not in (
    'Dụng cụ', 'Bao bì', 'In ấn - quảng cáo', 'Vận chuyển', 'Khác', 'Đồ uống', 'Nguyên liệu', 'Quảng cáo'
  ) then
    raise exception 'Nhóm chi phí không hợp lệ';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_unit_price is null or p_unit_price < 0
     or p_amount is null or p_amount <= 0 then
    raise exception 'Số lượng, đơn giá hoặc thành tiền không hợp lệ';
  end if;

  update public.expenses
  set expense_date = p_expense_date,
      category     = p_category,
      note         = nullif(btrim(coalesce(p_note, '')), ''),
      quantity     = p_quantity,
      unit_price   = round(p_unit_price, 2),
      amount       = p_amount
  where id = p_expense_id;

  if not found then
    raise exception 'Không tìm thấy khoản chi phí';
  end if;
end;
$$;

create or replace function public.delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được xoá chi phí' using errcode = '42501';
  end if;

  delete from public.expenses where id = p_expense_id;

  if not found then
    raise exception 'Không tìm thấy khoản chi phí';
  end if;
end;
$$;

revoke execute on function public.update_expense(uuid, date, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.update_expense(uuid, date, text, text, numeric, numeric, numeric) to authenticated;
revoke execute on function public.delete_expense(uuid) from public, anon;
grant execute on function public.delete_expense(uuid) to authenticated;
