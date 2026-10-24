-- =============================================================================
-- Thêm nhóm chi phí cố định cho quán Bún đậu: Tiền nhà, Điện nước, Lương nhân viên.
--   * expenses_category_check và update_expense nhận thêm 3 nhóm (danh sách nhóm theo quán nằm ở src/lib/expenses.ts).
-- =============================================================================

alter table public.expenses drop constraint expenses_category_check;
alter table public.expenses
  add constraint expenses_category_check check (category in (
    'Dụng cụ', 'Bao bì', 'In ấn - quảng cáo', 'Vận chuyển', 'Khác',
    'Đồ uống', 'Nguyên liệu', 'Quảng cáo',
    'Tiền nhà', 'Điện nước', 'Lương nhân viên'
  ));

comment on column public.expenses.category is
  'Nhóm chi phí. Hogi: Dụng cụ / Bao bì / In ấn - quảng cáo / Vận chuyển / Khác; Bún đậu: Đồ uống / Nguyên liệu / Dụng cụ / Quảng cáo / Tiền nhà / Điện nước / Lương nhân viên / Khác';

create or replace function public.update_expense(
  p_expense_id uuid, p_expense_date date, p_category text, p_note text,
  p_quantity numeric, p_unit_price numeric, p_amount numeric
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
    'Dụng cụ', 'Bao bì', 'In ấn - quảng cáo', 'Vận chuyển', 'Khác', 'Đồ uống', 'Nguyên liệu', 'Quảng cáo',
    'Tiền nhà', 'Điện nước', 'Lương nhân viên'
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
