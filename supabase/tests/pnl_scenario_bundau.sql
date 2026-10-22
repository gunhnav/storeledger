-- Kiểm tra lãi lỗ end-to-end trên DB thật mà KHÔNG để lại dữ liệu: dựng nhập kho + bán (quán + đối tác) của Bún đậu,
-- gọi get_pnl / get_break_even / get_daily_summary rồi RAISE EXCEPTION để rollback toàn bộ.
-- Chạy: npx supabase db query --linked -f supabase/tests/pnl_scenario_bundau.sql   (đọc kết quả sau chữ SCENARIO_RESULT)
-- Kỳ vọng ngày 2026-10-21: doanh thu gộp 100.000, hoa hồng 10.000, doanh thu thuần 90.000, giá vốn 52.000,
--   lãi gộp 38.000, chi phí 0 (khoản chi từ nhập kho bị bỏ qua), lãi ròng 38.000; tiền nhập 140.000; hàng tồn 88.000.

do $$
declare
  v_admin uuid := (select id from public.profiles where role='admin' order by created_at limit 1);
  v_store uuid := (select id from public.stores where code='bundau');
  v_p1 uuid := (select id from public.products where store_id=(select id from public.stores where code='bundau') and name='Coca');
  v_p2 uuid := (select id from public.products where store_id=(select id from public.stores where code='bundau') and name='Pepsi');
  v_purchase uuid; v_out jsonb := '{}'::jsonb; r record; v_sale uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  -- Nhập 10 Coca @ 8.000 + 6 Pepsi @ 10.000 = 140.000 (ngày 2026-10-21)
  v_purchase := public.create_purchase(v_store, '2026-10-21', 'test', jsonb_build_array(
    jsonb_build_object('product_id', v_p1, 'quantity', 10, 'unit_cost', 8000),
    jsonb_build_object('product_id', v_p2, 'quantity', 6, 'unit_cost', 10000)));
  perform public.record_purchase_expenses(v_purchase, 'Đồ uống', jsonb_build_object(v_p2::text, 'Nguyên liệu'));
  perform public.create_transfer(v_store, v_p1, 10, '2026-10-21', 't', 'shop');
  perform public.create_transfer(v_store, v_p2, 6, '2026-10-21', 't', 'shop');
  select jsonb_agg(jsonb_build_object('cat', category, 'amount', amount, 'note', note) order by note) into r from public.expenses where purchase_id = v_purchase;
  v_out := v_out || jsonb_build_object('expenses_from_purchase', r);
  -- Bán tại quán: 4 Coca @ 15.000 = 60.000 (giá vốn 32.000); đối tác: 2 Pepsi @ 20.000 = 40.000 hoa hồng mặc định
  v_sale := public.create_sale(v_store, '2026-10-21', 'in_store', 'test', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 4, 'unit_price', 15000)));
  v_sale := public.create_sale(v_store, '2026-10-21', 'shopeefood', 'test', jsonb_build_array(jsonb_build_object('product_id', v_p2, 'quantity', 2, 'unit_price', 20000)));
  select jsonb_agg(to_jsonb(g)) into r from public.get_pnl(v_store, 'day', '2026-10-21', '2026-10-21') g;
  v_out := v_out || jsonb_build_object('pnl_2026_10_21', r);
  select to_jsonb(g) into r from public.get_break_even(v_store) g;
  v_out := v_out || jsonb_build_object('break_even', r);
  select jsonb_agg(to_jsonb(g)) into r from public.get_daily_summary(v_store, '2026-10-21', '2026-10-21') g;
  v_out := v_out || jsonb_build_object('daily_summary', r);
  raise exception 'SCENARIO_RESULT %', v_out::text;
end $$;
