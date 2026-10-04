BEGIN;

-- Provider quota: 15 requests/hour per API-key fingerprint.
-- Raw provider API keys are never stored in the database.

CREATE TABLE IF NOT EXISTS public.am_provider_api_hourly_usage (
  window_start timestamptz NOT NULL,
  key_id text NOT NULL CHECK (length(key_id) BETWEEN 8 AND 64),
  endpoint text NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  success_count integer NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (window_start, key_id, endpoint)
);

CREATE INDEX IF NOT EXISTS am_provider_api_hourly_usage_window_key_idx
  ON public.am_provider_api_hourly_usage(window_start DESC, key_id);

ALTER TABLE public.am_provider_api_hourly_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.am_provider_api_hourly_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.am_provider_api_hourly_usage TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_provider_api_request_hourly(
  p_window_start timestamptz,
  p_key_id text,
  p_endpoint text,
  p_hourly_limit integer
)
RETURNS TABLE (
  allowed boolean,
  request_count integer,
  total_request_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start timestamptz;
  v_total integer;
  v_row integer;
BEGIN
  IF p_window_start IS NULL
     OR p_key_id IS NULL
     OR length(trim(p_key_id)) < 8
     OR p_endpoint IS NULL
     OR length(trim(p_endpoint)) < 1 THEN
    RAISE EXCEPTION 'invalid provider hourly quota request';
  END IF;

  IF p_hourly_limit IS NULL OR p_hourly_limit < 1 THEN
    RAISE EXCEPTION 'invalid provider hourly limit';
  END IF;

  v_window_start := date_trunc('hour', p_window_start);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'am-provider-hourly-quota:' || v_window_start::text || ':' || trim(p_key_id),
      0
    )
  );

  SELECT COALESCE(SUM(u.request_count), 0)
  INTO v_total
  FROM public.am_provider_api_hourly_usage AS u
  WHERE u.window_start = v_window_start
    AND u.key_id = trim(p_key_id);

  IF v_total >= p_hourly_limit THEN
    RETURN QUERY SELECT false, 0, v_total;
    RETURN;
  END IF;

  INSERT INTO public.am_provider_api_hourly_usage AS u (
    window_start,
    key_id,
    endpoint,
    request_count
  )
  VALUES (
    v_window_start,
    trim(p_key_id),
    trim(p_endpoint),
    1
  )
  ON CONFLICT (window_start, key_id, endpoint)
  DO UPDATE SET
    request_count = u.request_count + 1,
    updated_at = now()
  RETURNING u.request_count INTO v_row;

  RETURN QUERY SELECT true, v_row, v_total + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_provider_api_result_hourly(
  p_window_start timestamptz,
  p_key_id text,
  p_endpoint text,
  p_success boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start timestamptz;
BEGIN
  IF p_window_start IS NULL
     OR p_key_id IS NULL
     OR length(trim(p_key_id)) < 8
     OR p_endpoint IS NULL
     OR length(trim(p_endpoint)) < 1 THEN
    RAISE EXCEPTION 'invalid provider hourly quota result';
  END IF;

  v_window_start := date_trunc('hour', p_window_start);

  INSERT INTO public.am_provider_api_hourly_usage AS u (
    window_start,
    key_id,
    endpoint,
    request_count,
    success_count,
    failed_count
  )
  VALUES (
    v_window_start,
    trim(p_key_id),
    trim(p_endpoint),
    0,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN p_success THEN 0 ELSE 1 END
  )
  ON CONFLICT (window_start, key_id, endpoint)
  DO UPDATE SET
    success_count = u.success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
    failed_count = u.failed_count + CASE WHEN p_success THEN 0 ELSE 1 END,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_am_provider_api_hourly_usage()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.am_provider_api_hourly_usage
  WHERE window_start < date_trunc('hour', now()) - interval '14 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_provider_api_request_hourly(timestamptz, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_provider_api_result_hourly(timestamptz, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_am_provider_api_hourly_usage()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_provider_api_request_hourly(timestamptz, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_provider_api_result_hourly(timestamptz, text, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_am_provider_api_hourly_usage()
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
