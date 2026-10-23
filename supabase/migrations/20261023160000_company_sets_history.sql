-- Lịch sử các set đã phân phối cho công ty (cả set đã bán hết): ngày, cỡ, thành phần, số set, đã bán.
-- get_company_sets chỉ trả set còn lại để bán; hàm này trả đầy đủ để xem lại.
create or replace function public.get_company_sets_history(p_store_id uuid, p_from date default null, p_to date default null)
returns table (
  id                 uuid,
  distribution_date  date,
  set_size           integer,
  set_count          integer,
  sold_count         integer,
  mix                jsonb,
  note               text,
  created_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (public.is_admin() or public.is_store_member(p_store_id)) then
    raise exception 'Bạn không có quyền xem cửa hàng này' using errcode = '42501';
  end if;

  return query
  select cs.id, cs.distribution_date, cs.set_size, cs.set_count, cs.sold_count, cs.mix, cs.note, cs.created_at
  from public.company_sets cs
  where cs.store_id = p_store_id
    and (p_from is null or cs.distribution_date >= p_from)
    and (p_to is null or cs.distribution_date <= p_to)
  order by cs.distribution_date desc, cs.created_at desc
  limit 300;
end;
$$;

revoke execute on function public.get_company_sets_history(uuid, date, date) from public, anon;
grant execute on function public.get_company_sets_history(uuid, date, date) to authenticated;
