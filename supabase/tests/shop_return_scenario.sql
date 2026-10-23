-- Chuyển hàng từ quán về nhà (Hogi), rollback toàn bộ. Chạy: npx supabase db query --linked -f supabase/tests/shop_return_scenario.sql
-- Kỳ vọng: Truyền thống chuyển 3 hũ quán -> nhà: nhà +3, quán -3; chuyển quá số ở quán bị từ chối; sau đó phân phối được cho công ty
-- bằng số vừa chuyển về; nhật ký ngày tính đúng (tồn nhà/quán cuối ngày).
do $$
declare
  v_admin uuid := (select id from public.profiles where role='admin' order by created_at limit 1);
  v_store uuid := (select id from public.stores where code='hogi');
  v_t uuid := (select id from public.products where store_id=(select id from public.stores where code='hogi') and name='Truyền thống');
  v_out jsonb := '{}'::jsonb; r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select to_jsonb(g) into r from public.get_stock_status(v_store) g where g.product_id = v_t;
  v_out := v_out || jsonb_build_object('before', r);
  perform public.create_shop_return(v_store, v_t, 3, '2026-10-23', 'test');
  select to_jsonb(g) into r from public.get_stock_status(v_store) g where g.product_id = v_t;
  v_out := v_out || jsonb_build_object('after_return', r);
  begin
    perform public.create_shop_return(v_store, v_t, 9999, '2026-10-23', 'test');
  exception when others then v_out := v_out || jsonb_build_object('too_many_error', sqlerrm);
  end;
  perform public.create_transfer(v_store, v_t, 3, '2026-10-23', 'test', 'company');
  select to_jsonb(g) into r from public.get_stock_status(v_store) g where g.product_id = v_t;
  v_out := v_out || jsonb_build_object('after_company', r);
  select jsonb_agg(to_jsonb(g)) into r from public.get_daily_product_log(v_store, '2026-10-23', '2026-10-23') g where g.product_id = v_t;
  v_out := v_out || jsonb_build_object('daily_log', r);
  raise exception 'SCENARIO_RESULT %', v_out::text;
end $$;
