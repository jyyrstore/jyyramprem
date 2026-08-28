-- Completes the runtime contract without weakening authorization.
-- Public content is read-only; broadcast execution remains owner-only.

create or replace function public.public_list_faq()
returns setof public.owner_faq
language sql
security definer
set search_path = public
as $$
  select f.*
  from public.owner_faq f
  where coalesce(f.is_active, true)
  order by coalesce(f.sort_order, 0), f.created_at;
$$;

create or replace function public.public_list_help()
returns setof public.owner_help_articles
language sql
security definer
set search_path = public
as $$
  select h.*
  from public.owner_help_articles h
  where coalesce(h.is_active, true)
  order by coalesce(h.sort_order, 0), h.created_at;
$$;

revoke all on function public.public_list_faq() from public, anon, authenticated;
revoke all on function public.public_list_help() from public, anon, authenticated;
grant execute on function public.public_list_faq() to service_role;
grant execute on function public.public_list_help() to service_role;

-- Claim one scheduled broadcast atomically so an external cron/worker cannot
-- execute the same broadcast concurrently.
create or replace function public.owner_claim_due_broadcast(p_broadcast_id uuid)
returns public.owner_broadcasts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.owner_broadcasts;
begin
  if not public.is_owner(auth.uid()) then
    raise exception 'owner access required';
  end if;

  update public.owner_broadcasts
     set status = 'sending',
         updated_at = now()
   where id = p_broadcast_id
     and status = 'scheduled'
     and scheduled_at is not null
     and scheduled_at <= now()
  returning * into v_row;

  if not found then
    raise exception 'broadcast is not due or already claimed';
  end if;

  return v_row;
end;
$$;

revoke all on function public.owner_claim_due_broadcast(uuid) from public, anon, authenticated;
grant execute on function public.owner_claim_due_broadcast(uuid) to service_role;
