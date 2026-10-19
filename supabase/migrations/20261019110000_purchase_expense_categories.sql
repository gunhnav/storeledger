-- record_purchase_expenses: nhóm chi phí theo từng món.
--   p_category: nhóm mặc định; p_categories: { "<product_id>": "<nhóm>" } ghi đè theo món.
--   Chỉ nhận nhóm 'Đồ uống' hoặc 'Nguyên liệu'.
drop function public.record_purchase_expenses(uuid, text);

create or replace function public.record_purchase_expenses(
  p_purchase_id  uuid,
  p_category     text,
  p_categories   jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase  record;
  v_count     integer;
  v_cat       text;
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
  if p_categories is null or jsonb_typeof(p_categories) <> 'object' then
    raise exception 'Nhóm chi phí không hợp lệ';
  end if;
  for v_cat in select p_category union all select e.value from jsonb_each_text(p_categories) as e loop
    if v_cat is null or v_cat not in ('Đồ uống', 'Nguyên liệu') then
      raise exception 'Nhóm chi phí không hợp lệ';
    end if;
  end loop;
  if exists (select 1 from public.expenses e where e.purchase_id = p_purchase_id) then
    return 0;
  end if;

  insert into public.expenses (store_id, expense_date, category, amount, quantity, unit_price, note, purchase_id)
  select v_purchase.store_id, v_purchase.purchase_date, coalesce(p_categories ->> b.product_id::text, p_category),
         round(b.initial_qty * b.unit_cost), b.initial_qty, b.unit_cost, 'Nhập kho: ' || pr.name, p_purchase_id
  from public.stock_batches b
  join public.products pr on pr.id = b.product_id
  where b.purchase_id = p_purchase_id and round(b.initial_qty * b.unit_cost) > 0;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.record_purchase_expenses(uuid, text, jsonb) from public, anon;
grant execute on function public.record_purchase_expenses(uuid, text, jsonb) to authenticated;
