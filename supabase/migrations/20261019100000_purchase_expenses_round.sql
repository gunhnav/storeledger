-- record_purchase_expenses: làm tròn thành tiền về đồng (VND không có số lẻ).
-- Đơn giá lô lưu 2 số lẻ nên số lượng × đơn giá có thể lệch vài xu so với thành tiền admin nhập
-- (ví dụ 3 × 33.333,33 = 99.999,99 thay vì 100.000).

create or replace function public.record_purchase_expenses(
  p_purchase_id  uuid,
  p_category     text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase  record;
  v_count     integer;
begin
  select p.store_id, p.purchase_date into v_purchase
  from public.purchases p
  where p.id = p_purchase_id;
  if not found then
    raise exception 'Không tìm thấy đợt nhập';
  end if;
  if not (public.is_admin() or public.is_store_member(v_purchase.store_id)) then
    raise exception 'Bạn không có quyền thao tác với cửa hàng này' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('Đồ uống', 'Nguyên liệu') then
    raise exception 'Nhóm chi phí không hợp lệ';
  end if;
  if exists (select 1 from public.expenses e where e.purchase_id = p_purchase_id) then
    return 0;
  end if;

  insert into public.expenses (store_id, expense_date, category, amount, quantity, unit_price, note, purchase_id)
  select v_purchase.store_id, v_purchase.purchase_date, p_category,
         round(b.initial_qty * b.unit_cost), b.initial_qty, b.unit_cost, 'Nhập kho: ' || pr.name, p_purchase_id
  from public.stock_batches b
  join public.products pr on pr.id = b.product_id
  where b.purchase_id = p_purchase_id and round(b.initial_qty * b.unit_cost) > 0;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
