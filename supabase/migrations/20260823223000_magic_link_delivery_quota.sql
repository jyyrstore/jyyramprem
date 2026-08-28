-- Magic-link delivery quota.
-- The user's daily quota is consumed exactly once per generated account,
-- only when a fresh magic link is actually delivered through the portal.
-- Generation itself does NOT consume this quota.

CREATE TABLE IF NOT EXISTS public.am_magic_link_quota_usage (
  usage_date date NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consumed_count integer NOT NULL DEFAULT 0 CHECK (consumed_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, user_id)
);

CREATE TABLE IF NOT EXISTS public.am_magic_link_deliveries (
  account_id uuid PRIMARY KEY REFERENCES public.am_generated_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quota_usage_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('provider_response', 'premium_activation')),
  link_fingerprint text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS am_magic_link_quota_usage_user_date_idx
  ON public.am_magic_link_quota_usage(user_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS am_magic_link_deliveries_user_received_idx
  ON public.am_magic_link_deliveries(user_id, received_at DESC);

ALTER TABLE public.am_magic_link_quota_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_magic_link_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct client access to magic link quota" ON public.am_magic_link_quota_usage;
CREATE POLICY "No direct client access to magic link quota"
ON public.am_magic_link_quota_usage
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "No direct client access to magic link deliveries" ON public.am_magic_link_deliveries;
CREATE POLICY "No direct client access to magic link deliveries"
ON public.am_magic_link_deliveries
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.consume_magic_link_quota(
  p_user_id uuid,
  p_account_id uuid,
  p_usage_date date,
  p_daily_limit integer,
  p_source text
)
RETURNS TABLE (
  allowed boolean,
  already_consumed boolean,
  usage_date date,
  consumed_count integer,
  remaining_count integer,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_consumed integer;
  v_limit integer;
  v_existing boolean;
  v_account_user uuid;
BEGIN
  IF p_user_id IS NULL OR p_account_id IS NULL OR p_usage_date IS NULL THEN
    RAISE EXCEPTION 'Invalid magic link quota identity';
  END IF;

  IF p_daily_limit IS NULL OR p_daily_limit < 1 THEN
    RAISE EXCEPTION 'Invalid magic link daily limit';
  END IF;

  IF p_source NOT IN ('provider_response', 'premium_activation') THEN
    RAISE EXCEPTION 'Invalid magic link delivery source';
  END IF;

  SELECT user_id INTO v_account_user
  FROM public.am_generated_accounts
  WHERE id = p_account_id;

  IF v_account_user IS NULL OR v_account_user <> p_user_id THEN
    RETURN QUERY SELECT false, false, p_usage_date, 0, 0, 'ACCOUNT_NOT_FOUND'::text;
    RETURN;
  END IF;

  -- Serialize quota decisions per user/day. This prevents two concurrent
  -- delivery paths from consuming the same daily slot twice.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('am-magic-link-quota:' || p_user_id::text || ':' || p_usage_date::text, 0)
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.am_magic_link_deliveries
    WHERE account_id = p_account_id
  ) INTO v_existing;

  SELECT q.consumed_count
INTO v_consumed
FROM public.am_magic_link_quota_usage AS q
WHERE q.usage_date = p_usage_date
  AND q.user_id = p_user_id
FOR UPDATE;

  v_consumed := COALESCE(v_consumed, 0);
  v_limit := p_daily_limit;

  IF v_existing THEN
    RETURN QUERY SELECT true, true, p_usage_date, v_consumed, GREATEST(v_limit - v_consumed, 0), 'ALREADY_CONSUMED'::text;
    RETURN;
  END IF;

  IF v_consumed >= v_limit THEN
    RETURN QUERY SELECT false, false, p_usage_date, v_consumed, 0, 'DAILY_LIMIT_REACHED'::text;
    RETURN;
  END IF;

  INSERT INTO public.am_magic_link_quota_usage (
    usage_date, user_id, consumed_count, updated_at
  ) VALUES (
    p_usage_date, p_user_id, 1, now()
  )
  ON CONFLICT (usage_date, user_id)
  DO UPDATE SET
    consumed_count = public.am_magic_link_quota_usage.consumed_count + 1,
    updated_at = now();

  v_consumed := v_consumed + 1;

  INSERT INTO public.am_magic_link_deliveries (
    account_id,
    user_id,
    quota_usage_date,
    source,
    received_at
  ) VALUES (
    p_account_id,
    p_user_id,
    p_usage_date,
    p_source,
    now()
  );

  RETURN QUERY SELECT true, false, p_usage_date, v_consumed, GREATEST(v_limit - v_consumed, 0), 'CONSUMED'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_magic_link_quota(uuid, uuid, date, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_magic_link_quota(uuid, uuid, date, integer, text)
  TO service_role;
