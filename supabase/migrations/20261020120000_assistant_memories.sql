-- =============================================================================
-- assistant_memories — Điều người dùng dặn trợ lý Roona ghi nhớ lâu dài
-- (ví dụ "nói hũ / hủ là Hogi"). Mỗi người chỉ thấy và sửa ghi nhớ của chính mình.
-- Edge function chat-assistant đọc / ghi bằng token của người dùng nên RLS áp dụng.
-- =============================================================================

create table if not exists public.assistant_memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content     text not null check (char_length(btrim(content)) between 1 and 300),
  created_at  timestamptz not null default now()
);

create index if not exists assistant_memories_user_idx on public.assistant_memories (user_id, created_at);

alter table public.assistant_memories enable row level security;
revoke all on table public.assistant_memories from public, anon;
grant select, insert, delete on public.assistant_memories to authenticated;

drop policy if exists assistant_memories_select_own on public.assistant_memories;
create policy assistant_memories_select_own on public.assistant_memories
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists assistant_memories_insert_own on public.assistant_memories;
create policy assistant_memories_insert_own on public.assistant_memories
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists assistant_memories_delete_own on public.assistant_memories;
create policy assistant_memories_delete_own on public.assistant_memories
  for delete to authenticated using (user_id = (select auth.uid()));

comment on table public.assistant_memories is 'Ghi nhớ lâu dài của trợ lý Roona theo từng người dùng (RLS: chỉ chủ sở hữu)';
