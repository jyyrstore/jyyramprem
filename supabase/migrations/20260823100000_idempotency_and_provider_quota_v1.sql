-- Generation idempotency + outbound provider request quota.
-- Server-managed only; browser roles receive no direct table access.

CREATE TABLE IF NOT EXISTS public.am_generation_idempotency (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_hash text NOT NULL,
  account_id uuid REFERENCES public.am_generated_accounts(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed','failed')),
  http_status integer,
  response_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_hash)
);

CREATE INDEX IF NOT EXISTS am_generation_idempotency_created_idx
  ON public.am_generation_idempotency(created_at DESC);

CREATE TABLE IF NOT EXISTS public.am_provider_api_usage (
  usage_date date NOT NULL,
  endpoint text NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  success_count integer NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, endpoint)
);

CREATE INDEX IF NOT EXISTS am_provider_api_usage_date_idx
  ON public.am_provider_api_usage(usage_date);

ALTER TABLE public.am_generation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_provider_api_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.am_generation_idempotency FROM anon, authenticated;
REVOKE ALL ON TABLE public.am_provider_api_usage FROM anon, authenticated;
GRANT ALL ON TABLE public.am_generation_idempotency TO service_role;
GRANT ALL ON TABLE public.am_provider_api_usage TO service_role;

CREATE OR REPLACE FUNCTION public.claim_generation_request(
  p_user_id uuid,
  p_idempotency_hash text
)
RETURNS TABLE (
  is_new boolean,
  state text,
  account_id uuid,
  http_status integer,
  response_body jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  INSERT INTO public.am_generated_accounts (user_id, status, provider_response)
  VALUES (p_user_id, 'pending', '{}'::jsonb)
  RETURNING id INTO v_account_id;

  INSERT INTO public.am_generation_idempotency (
    user_id, idempotency_hash, account_id, state
  ) VALUES (
    p_user_id, p_idempotency_hash, v_account_id, 'pending'
  )
  ON CONFLICT (user_id, idempotency_hash) DO NOTHING;

  IF FOUND THEN
    RETURN QUERY SELECT true, 'pending'::text, v_account_id, NULL::integer, '{}'::jsonb;
    RETURN;
  END IF;

  -- Another request already owns this key. Remove the unused account created
  -- above and return the existing durable state.
  DELETE FROM public.am_generated_accounts WHERE id = v_account_id;

  RETURN QUERY
  SELECT false, i.state, i.account_id, i.http_status, i.response_body
  FROM public.am_generation_idempotency i
  WHERE i.user_id = p_user_id
    AND i.idempotency_hash = p_idempotency_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_generation_request(
  p_user_id uuid,
  p_idempotency_hash text,
  p_state text,
  p_http_status integer,
  p_response_body jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.am_generation_idempotency
  SET state = p_state,
      http_status = p_http_status,
      response_body = COALESCE(p_response_body, '{}'::jsonb),
      updated_at = now()
  WHERE user_id = p_user_id
    AND idempotency_hash = p_idempotency_hash;
END;
$$;

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
  SELECT COALESCE(SUM(request_count), 0)
  INTO v_total
  FROM public.am_provider_api_usage
  WHERE usage_date = p_usage_date;

  IF v_total >= p_daily_limit THEN
    RETURN QUERY SELECT false, 0, v_total;
    RETURN;
  END IF;

  INSERT INTO public.am_provider_api_usage (
    usage_date, endpoint, request_count
  ) VALUES (
    p_usage_date, p_endpoint, 1
  )
  ON CONFLICT (usage_date, endpoint)
  DO UPDATE SET request_count = am_provider_api_usage.request_count + 1,
                updated_at = now()
  RETURNING request_count INTO v_row;

  RETURN QUERY SELECT true, v_row, v_total + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_provider_api_result(
  p_usage_date date,
  p_endpoint text,
  p_success boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.am_provider_api_usage (
    usage_date, endpoint, request_count, success_count, failed_count
  ) VALUES (
    p_usage_date, p_endpoint, 0,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN p_success THEN 0 ELSE 1 END
  )
  ON CONFLICT (usage_date, endpoint)
  DO UPDATE SET
    success_count = am_provider_api_usage.success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
    failed_count = am_provider_api_usage.failed_count + CASE WHEN p_success THEN 0 ELSE 1 END,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_am_generation_idempotency_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_am_generation_idempotency_updated_at
  ON public.am_generation_idempotency;
CREATE TRIGGER trg_am_generation_idempotency_updated_at
BEFORE UPDATE ON public.am_generation_idempotency
FOR EACH ROW EXECUTE FUNCTION public.set_am_generation_idempotency_updated_at();

REVOKE ALL ON FUNCTION public.claim_generation_request(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_generation_request(uuid, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_provider_api_request(date, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_provider_api_result(date, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_generation_request(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_generation_request(uuid, text, text, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_provider_api_request(date, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_provider_api_result(date, text, boolean) TO service_role;

-- Keep only recent idempotency records. This is intentionally conservative:
-- clients can safely retry for 24 hours without creating a second account.
CREATE OR REPLACE FUNCTION public.cleanup_am_generation_idempotency()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.am_generation_idempotency
  WHERE updated_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_am_generation_idempotency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_am_generation_idempotency() TO service_role;
