-- Giảm giá đơn bán (số tiền / %), rollback toàn bộ. Chạy: npx supabase db query --linked -f supabase/tests/sale_discount_scenario.sql
-- Kỳ vọng: bán 4 Coca @15.000 giảm 10% -> trả 54.000 (giảm 6.000); 2 Pepsi @20.000 giảm 5.000đ kênh đối tác -> trả 35.000,
--   hoa hồng 25% = 8.750; get_pnl: doanh thu gộp 89.000, hoa hồng 8.750, thuần 80.250.
do $$
declare
  v_admin uuid := (select id from public.profiles where role='admin' order by created_at limit 1);
  v_store uuid := (select id from public.stores where code='bundau');
  v_p1 uuid := (select id from public.products where store_id=(select id from public.stores where code='bundau') and name='Coca');
  v_p2 uuid := (select id from public.products where store_id=(select id from public.stores where code='bundau') and name='Pepsi');
  v_purchase uuid; v_out jsonb := '{}'::jsonb; r jsonb; v_s uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_purchase := public.create_purchase(v_store, '2026-10-21', 'test', jsonb_build_array(
    jsonb_build_object('product_id', v_p1, 'quantity', 10, 'unit_cost', 8000),
    jsonb_build_object('product_id', v_p2, 'quantity', 6, 'unit_cost', 10000)));
  perform public.create_transfer(v_store, v_p1, 10, '2026-10-21', 't', 'shop');
  perform public.create_transfer(v_store, v_p2, 6, '2026-10-21', 't', 'shop');
  v_s := public.create_sale_discounted(v_store, '2026-10-21', 'in_store', 't',
    jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 4, 'unit_price', 15000)), 'percent', 10);
  select to_jsonb(x) into r from (select list_total, discount_type, discount_value, discount_amount, total_amount from public.sales where id=v_s) x;
  v_out := v_out || jsonb_build_object('percent_sale', r);
  v_s := public.create_sale_discounted(v_store, '2026-10-21', 'shopeefood', 't',
    jsonb_build_array(jsonb_build_object('product_id', v_p2, 'quantity', 2, 'unit_price', 20000)), 'amount', 5000);
  select to_jsonb(x) into r from (select list_total, discount_type, discount_value, discount_amount, total_amount, commission_rate from public.sales where id=v_s) x;
  v_out := v_out || jsonb_build_object('amount_sale', r);
  select jsonb_agg(to_jsonb(g)) into r from public.get_pnl(v_store, 'day', '2026-10-21', '2026-10-21') g;
  v_out := v_out || jsonb_build_object('pnl', r);
  -- lỗi mong đợi
  begin
    perform public.create_sale_discounted(v_store, '2026-10-21', 'in_store', 't', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1, 'unit_price', 15000)), 'amount', 99999);
  exception when others then v_out := v_out || jsonb_build_object('too_big_error', sqlerrm);
  end;
  begin
    perform public.create_sale_discounted(v_store, '2026-10-21', 'company', 't', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1, 'unit_price', 15000)), 'percent', 10);
  exception when others then v_out := v_out || jsonb_build_object('company_error', sqlerrm);
  end;
  raise exception 'SCENARIO_RESULT %', v_out::text;
end $$;
