-- Owner SECURITY DEFINER functions must not inherit caller-controlled search_path.
alter function public.is_owner(uuid) set search_path = public, pg_temp;
alter function public.require_owner() set search_path = public, pg_temp;
