-- =============================================================================
-- Định lượng nguyên vật liệu từng món (quán Bún đậu), chép từ bảng của chủ quán.
--   * dish_recipes: món, giá bán, giá vốn (chủ quán tính), mã món trên máy POS (item_codes) để nối với
--     monthly_item_sales / doanh thu theo mặt hàng khi tính tồn kho nguyên vật liệu.
--   * dish_recipe_lines: nguyên vật liệu của một phần món. qty null = không định lượng (rau ăn kèm).
--     is_extra = phần cộng thêm sau dấu "+" của combo (ví dụ "+ 10 bún + 2 sữa đậu").
--   * Chỉ lưu dữ liệu để dùng sau; chưa trừ tồn kho. Chỉ admin đọc / ghi.
-- =============================================================================

create table if not exists public.dish_recipes (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  sale_price  numeric(12,2) not null check (sale_price >= 0),
  unit_cost   numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  item_codes  text[] not null default '{}',
  note        text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists public.dish_recipe_lines (
  id          uuid primary key default gen_random_uuid(),
  recipe_id   uuid not null references public.dish_recipes (id) on delete cascade,
  ingredient  text not null check (char_length(btrim(ingredient)) between 1 and 80),
  qty         numeric(10,2) check (qty is null or qty > 0),
  unit        text,
  is_extra    boolean not null default false,
  note        text,
  sort_order  integer not null default 0
);
create index if not exists dish_recipe_lines_recipe_idx on public.dish_recipe_lines (recipe_id);

alter table public.dish_recipes enable row level security;
alter table public.dish_recipe_lines enable row level security;
revoke all on table public.dish_recipes, public.dish_recipe_lines from public, anon;
grant select, insert, update, delete on public.dish_recipes, public.dish_recipe_lines to authenticated;

drop policy if exists dish_recipes_admin on public.dish_recipes;
create policy dish_recipes_admin on public.dish_recipes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists dish_recipe_lines_admin on public.dish_recipe_lines;
create policy dish_recipe_lines_admin on public.dish_recipe_lines
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
