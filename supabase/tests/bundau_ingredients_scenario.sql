-- Nguyên liệu + công thức + báo cáo Bún đậu, rollback toàn bộ.
-- Chạy: npx supabase db query --linked -f supabase/tests/bundau_ingredients_scenario.sql
-- Kỳ vọng: nhập 100 miếng chả cốm (300.000đ -> ghi 1 khoản chi), bán 5 "Bún đậu chả cốm" (2 miếng/phần, 45.000đ/phần):
--   tồn = 100 - 10 = 90, doanh thu 225.000, chi phí 300.000, lãi ròng -75.000 (giá vốn món = 0, tiền nguyên liệu ở chi phí).
do $$
declare
  v_admin uuid := (select id from public.profiles where role='admin' order by created_at limit 1);
  v_store uuid := (select id from public.stores where code='bundau');
  v_dish uuid := (select id from public.products where store_id=(select id from public.stores where code='bundau') and name='Bún đậu chả cốm');
  v_ing uuid; v_out jsonb := '{}'::jsonb; r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  insert into public.ingredients (store_id, name, unit, low_stock_threshold) values (v_store, 'Chả cốm test', 'miếng', 20) returning id into v_ing;
  perform public.set_recipe(v_dish, jsonb_build_array(jsonb_build_object('ingredient_id', v_ing, 'qty', 2)));
  perform public.receive_ingredients(v_store, '2026-10-22', jsonb_build_array(jsonb_build_object('ingredient_id', v_ing, 'quantity', 100, 'amount', 300000, 'category', 'Nguyên liệu')));
  perform public.create_sale(v_store, '2026-10-22', 'in_store', 't', jsonb_build_array(jsonb_build_object('product_id', v_dish, 'quantity', 5, 'unit_price', 45000)));
  select jsonb_agg(to_jsonb(g)) into r from public.get_ingredient_stock(v_store) g where g.name = 'Chả cốm test';
  v_out := v_out || jsonb_build_object('stock', r);
  select jsonb_agg(to_jsonb(g)) into r from public.get_pnl(v_store, 'day', '2026-10-22', '2026-10-22') g;
  v_out := v_out || jsonb_build_object('pnl', r);
  v_out := v_out || jsonb_build_object('report', public.get_bundau_report(v_store, '2026-10-22', '2026-10-22'));
  raise exception 'SCENARIO_RESULT %', v_out::text;
end $$;
