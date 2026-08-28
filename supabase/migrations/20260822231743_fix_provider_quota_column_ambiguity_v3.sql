-- Harden provider quota reservation against races and PL/pgSQL output-variable
-- ambiguity. Reservations for one usage date are serialized.
CREATE OR REPLACE FUNCTION public.reserve_provider_api_request(
  p_usage_date date,
  p_endpoint text,
  p_daily_limit integer
)
RETURNS TABLE (allowed boolean, request_count integer, total_request_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total integer;
  v_row integer;
BEGIN
  IF p_daily_limit IS NULL OR p_daily_limit < 1 THEN
    RAISE EXCEPTION 'invalid provider daily limit';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('am-provider-quota:' || p_usage_date::text, 0));
  SELECT COALESCE(SUM(u.request_count), 0) INTO v_total
  FROM public.am_provider_api_usage AS u
  WHERE u.usage_date = p_usage_date;
  IF v_total >= p_daily_limit THEN
    RETURN QUERY SELECT false, 0, v_total;
    RETURN;
  END IF;
  INSERT INTO public.am_provider_api_usage AS u (usage_date, endpoint, request_count)
  VALUES (p_usage_date, p_endpoint, 1)
  ON CONFLICT (usage_date, endpoint)
  DO UPDATE SET request_count = u.request_count + 1, updated_at = now()
  RETURNING u.request_count INTO v_row;
  RETURN QUERY SELECT true, v_row, v_total + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_provider_api_request(date,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_provider_api_request(date,text,integer) TO service_role;
