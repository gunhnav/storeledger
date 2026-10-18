-- =============================================================================
-- expense_details — Chi phí đồ dùng chi tiết: số lượng, đơn giá, thành tiền; 5 nhóm cố định.
--   * amount giữ nguyên ý nghĩa = THÀNH TIỀN (mọi báo cáo đang cộng amount nên tổng không đổi).
--   * Thành tiền mặc định = số lượng × đơn giá; người dùng được ghi đè thành tiền,
--     khi đó đơn giá lưu = thành tiền ÷ số lượng (làm tròn 2 chữ số, thành tiền vẫn là số gốc).
--   * Dữ liệu cũ: số lượng = 1, đơn giá = số tiền cũ; nhóm chữ tự do không khớp 5 nhóm → 'Khác'
--     và chữ cũ được chép vào đầu ghi chú để không mất thông tin. Không xoá dòng nào.
-- =============================================================================

alter table public.expenses
  add column quantity    numeric(12,2) not null default 1,
  add column unit_price  numeric(14,2);

update public.expenses
set unit_price = amount
where unit_price is null;

-- Nhóm cũ không thuộc 5 nhóm mới: giữ chữ cũ trong ghi chú rồi đổi nhóm thành 'Khác'
update public.expenses
set note = case
             when note is null or btrim(note) = '' then category
             else category || ' – ' || note
           end,
    category = 'Khác'
where category not in ('Dụng cụ', 'Bao bì', 'In ấn - quảng cáo', 'Vận chuyển', 'Khác');

alter table public.expenses
  alter column unit_price set not null,
  add constraint expenses_quantity_range_check check (quantity > 0 and quantity <= 1000000),
  add constraint expenses_unit_price_range_check check (unit_price >= 0 and unit_price <= 1000000000),
  add constraint expenses_category_check
    check (category in ('Dụng cụ', 'Bao bì', 'In ấn - quảng cáo', 'Vận chuyển', 'Khác'));

comment on column public.expenses.amount is 'Thành tiền (mặc định = quantity × unit_price, cho phép ghi đè)';
comment on column public.expenses.quantity is 'Số lượng';
comment on column public.expenses.unit_price is 'Đơn giá (khi ghi đè thành tiền: = amount ÷ quantity, làm tròn)';
comment on column public.expenses.category is 'Nhóm: Dụng cụ / Bao bì / In ấn - quảng cáo / Vận chuyển / Khác';
