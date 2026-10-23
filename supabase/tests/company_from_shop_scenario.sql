-- Phân phối cho công ty lấy từ quán khi nhà thiếu (Hogi), rollback toàn bộ.
-- Chạy: npx supabase db query --linked -f supabase/tests/company_from_shop_scenario.sql
-- Kỳ vọng: nhà còn H, yêu cầu 1 set 4 hũ có (H+2) hũ Truyền thống -> tự chuyển 2 hũ quán -> nhà rồi phân phối: nhà 0, công ty +H+2, quán -2;
--   yêu cầu vượt cả nhà + quán bị từ chối.
do $$
declare
  v_admin uuid := (select id from public.profiles where role='admin' order by created_at limit 1);
  v_store uuid := (select id from public.stores where code='hogi');
  v_t uuid := (select id from public.products where store_id=(select id from public.stores where code='hogi') and name='Truyền thống');
  v_out jsonb := '{}'::jsonb; r jsonb; v_home int; v_shop int; v_mix jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select qty_home, qty_shop into v_home, v_shop from public.get_stock_status(v_store) where product_id = v_t;
  v_out := v_out || jsonb_build_object('before', jsonb_build_object('home', v_home, 'shop', v_shop));
  -- v_home + 2 hũ: set 4 hũ x count; dùng set 4 gồm 4 Truyền thống, số set = ceil((home+2)/4) rồi cắt cho khớp bằng set có mix 4: chọn count sao cho 4*count > home
  v_mix := jsonb_build_object(v_t::text, 4);
  perform public.create_company_distribution(v_store, '2026-10-23', 'test', jsonb_build_array(jsonb_build_object('size', 4, 'count', (v_home / 4) + 1, 'mix', v_mix)));
  select to_jsonb(g) into r from public.get_stock_status(v_store) g where g.product_id = v_t;
  v_out := v_out || jsonb_build_object('after', r, 'need', 4 * ((v_home / 4) + 1));
  begin
    perform public.create_company_distribution(v_store, '2026-10-23', 'test', jsonb_build_array(jsonb_build_object('size', 4, 'count', 5000, 'mix', v_mix)));
  exception when others then v_out := v_out || jsonb_build_object('too_many_error', sqlerrm);
  end;
  raise exception 'SCENARIO_RESULT %', v_out::text;
end $$;
