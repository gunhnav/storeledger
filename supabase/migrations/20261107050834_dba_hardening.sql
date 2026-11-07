-- Rà soát DBA (07/11/2026) theo `supabase db advisors` + pg_stat_statements. Không đổi dữ liệu, chạy lại an toàn.
--
-- 1. Bảo mật hàm: anon (khách chưa đăng nhập) chỉ cần get_public_menu + submit_preorder.
--    Các hàm khác đã tự kiểm tra is_admin() bên trong, nhưng vẫn khoá quyền EXECUTE từ ngoài (phòng thủ nhiều lớp).
-- 2. Hàm Vault: search_path = '' (mọi tên đã ghi rõ schema) để tránh bị chèn object cùng tên.
-- 3. Index cho 3 khoá ngoại created_by còn thiếu.
-- 4. ingredients: tách policy FOR ALL thành insert/update/delete để SELECT chỉ còn 1 policy.
-- 5. expenses: bỏ CHECK trùng (amount >= 0) vì đã có amount > 0 AND <= 1 tỷ.

-- 1. Quyền EXECUTE ------------------------------------------------------------
-- Gọi từ app sau khi đăng nhập: bỏ anon / PUBLIC, giữ authenticated (hàm tự kiểm tra admin / thành viên quán)
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

revoke execute on function public.can_access_store(uuid) from public, anon;
grant execute on function public.can_access_store(uuid) to authenticated;

revoke execute on function public.get_vault_secret(text) from public, anon;
grant execute on function public.get_vault_secret(text) to authenticated;

-- Hàm event trigger (tự bật RLS cho bảng mới): không ai cần gọi qua API
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 2. search_path rỗng cho hàm Vault ---------------------------------------------
alter function public.get_vault_secret(text) set search_path = '';
alter function public.admin_set_vault_secret(text, text) set search_path = '';

-- 3. Index khoá ngoại ------------------------------------------------------------
create index if not exists company_sets_created_by_idx on public.company_sets (created_by);
create index if not exists ingredient_receipts_created_by_idx on public.ingredient_receipts (created_by);
create index if not exists stock_disposals_created_by_idx on public.stock_disposals (created_by);

-- 4. ingredients: một policy SELECT duy nhất ------------------------------------------
drop policy if exists ingredients_write_admin on public.ingredients;
drop policy if exists ingredients_insert_admin on public.ingredients;
drop policy if exists ingredients_update_admin on public.ingredients;
drop policy if exists ingredients_delete_admin on public.ingredients;
create policy ingredients_insert_admin on public.ingredients
  for insert to authenticated
  with check ((select public.is_admin()));
create policy ingredients_update_admin on public.ingredients
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy ingredients_delete_admin on public.ingredients
  for delete to authenticated
  using ((select public.is_admin()));

-- 5. CHECK trùng ---------------------------------------------------------------
alter table public.expenses drop constraint if exists expenses_amount_check;

-- Ghi chú cho người đọc sau: company_sets cố ý không có policy, chỉ đọc / ghi qua RPC security definer
comment on table public.company_sets is
  'Set phân phối cho công ty. RLS bật, cố ý không có policy: chỉ truy cập qua get_company_sets, create_company_distribution, create_company_sale, create_company_return.';
