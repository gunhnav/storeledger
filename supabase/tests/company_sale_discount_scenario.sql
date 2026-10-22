-- Giảm giá đơn Công ty (Hogi), rollback toàn bộ. Chạy: npx supabase db query --linked -f supabase/tests/company_sale_discount_scenario.sql
-- Kỳ vọng: phân phối 1 set 4 (2 Matcha + 2 Truyền thống), bán 55.000 giảm 10% -> khách trả 49.500, giảm 5.500;
--   set còn lại 0. Lỗi mong đợi: tổng tiền không khớp giảm giá.
do $$
declare
  v_admin uuid := (select id from public.profiles where role='admin' order by created_at limit 1);
  v_store uuid := (select id from public.stores where code='hogi');
  v_m uuid := (select id from public.products where store_id=(select id from public.stores where code='hogi') and name='Matcha');
  v_t uuid := (select id from public.products where store_id=(select id from public.stores where code='hogi') and name='Truyền thống');
  v_out jsonb := '{}'::jsonb; r jsonb; v_s uuid; v_mix jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_mix := jsonb_build_object(v_m::text, 2, v_t::text, 2);
  perform public.create_company_distribution(v_store, '2026-10-22', 'test', jsonb_build_array(jsonb_build_object('size', 4, 'count', 1, 'mix', v_mix)));
  -- 55.000 giảm 10% = 49.500, chia: Matcha 2 x 13.750, Truyền thống 2 x 11.000
  v_s := public.create_company_sale(v_store, '2026-10-22', 'test', jsonb_build_array(
      jsonb_build_object('product_id', v_m, 'quantity', 2, 'unit_price', 13750),
      jsonb_build_object('product_id', v_t, 'quantity', 2, 'unit_price', 11000)),
    jsonb_build_array(jsonb_build_object('size', 4, 'mix', v_mix, 'count', 1)),
    'percent', 10, 55000);
  select to_jsonb(x) into r from (select list_total, discount_type, discount_value, discount_amount, total_amount, channel from public.sales where id=v_s) x;
  v_out := v_out || jsonb_build_object('sale', r);
  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into r from public.get_company_sets(v_store) g where g.distribution_date = '2026-10-22';
  v_out := v_out || jsonb_build_object('sets_left_today', r);
  begin
    perform public.create_company_distribution(v_store, '2026-10-22', 'test2', jsonb_build_array(jsonb_build_object('size', 4, 'count', 1, 'mix', v_mix)));
    perform public.create_company_sale(v_store, '2026-10-22', 'test', jsonb_build_array(
        jsonb_build_object('product_id', v_m, 'quantity', 2, 'unit_price', 13750),
        jsonb_build_object('product_id', v_t, 'quantity', 2, 'unit_price', 11000)),
      jsonb_build_array(jsonb_build_object('size', 4, 'mix', v_mix, 'count', 1)),
      'percent', 20, 55000);
  exception when others then v_out := v_out || jsonb_build_object('mismatch_error', sqlerrm);
  end;
  raise exception 'SCENARIO_RESULT %', v_out::text;
end $$;
