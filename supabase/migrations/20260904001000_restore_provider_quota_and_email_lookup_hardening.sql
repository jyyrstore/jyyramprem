BEGIN;

-- Restore the race-safe provider quota reservation as the final definition.
-- The later idempotency/quota migration had accidentally redefined this RPC
-- without its advisory lock, so this migration deliberately becomes the
-- authoritative last definition.
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
  IF p_usage_date IS NULL OR p_endpoint IS NULL OR length(trim(p_endpoint)) < 1 THEN
    RAISE EXCEPTION 'invalid provider quota request';
  END IF;
  IF p_daily_limit IS NULL OR p_daily_limit < 1 THEN
    RAISE EXCEPTION 'invalid provider daily limit';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('am-provider-quota:' || p_usage_date::text, 0)
  );

  SELECT COALESCE(SUM(u.request_count), 0)
  INTO v_total
  FROM public.am_provider_api_usage AS u
  WHERE u.usage_date = p_usage_date;

  IF v_total >= p_daily_limit THEN
    RETURN QUERY SELECT false, 0, v_total;
    RETURN;
  END IF;

  INSERT INTO public.am_provider_api_usage AS u (
    usage_date, endpoint, request_count
  )
  VALUES (
    p_usage_date, trim(p_endpoint), 1
  )
  ON CONFLICT (usage_date, endpoint)
  DO UPDATE SET
    request_count = u.request_count + 1,
    updated_at = now()
  RETURNING u.request_count INTO v_row;

  RETURN QUERY SELECT true, v_row, v_total + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_provider_api_request(date, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_provider_api_request(date, text, integer) TO service_role;

-- Lookup index used by resend/verify so those public routes only touch the
-- verification records for the requested email.
CREATE INDEX IF NOT EXISTS am_email_verifications_email_active_idx
  ON public.am_email_verifications (lower(email), created_at DESC)
  WHERE used_at IS NULL;

-- Keep the bounded idempotency cleanup function available to a scheduler.
CREATE OR REPLACE FUNCTION public.cleanup_am_generation_idempotency()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.am_generation_idempotency
  WHERE updated_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_am_generation_idempotency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_am_generation_idempotency() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
