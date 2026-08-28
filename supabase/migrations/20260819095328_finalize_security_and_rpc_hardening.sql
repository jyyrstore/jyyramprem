-- Final security hardening + account-scoped API quota.
-- IMPORTANT: usage is intentionally per account, not per feature and not global.

ALTER TABLE public.am_generated_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_generation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_api_usage ENABLE ROW LEVEL SECURITY;

-- Account ownership.
DROP POLICY IF EXISTS "Users can view own generated accounts" ON public.am_generated_accounts;
CREATE POLICY "Users can view own generated accounts"
ON public.am_generated_accounts
FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own generation logs" ON public.am_generation_logs;
CREATE POLICY "Users can view own generation logs"
ON public.am_generation_logs
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.am_generated_accounts a
  WHERE a.id = account_id
    AND a.user_id = (select auth.uid())
));

-- Browser clients must never read/write usage directly.
DROP POLICY IF EXISTS "No direct client access to global usage" ON public.am_api_usage;
DROP POLICY IF EXISTS "No direct client access to account usage" ON public.am_api_usage;
CREATE POLICY "No direct client access to account usage"
ON public.am_api_usage
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);

-- The quota row is uniquely identified by account + day.
ALTER TABLE public.am_api_usage
  ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
DECLARE
  null_count bigint;
  constraint_name text;
BEGIN
  SELECT count(*) INTO null_count
  FROM public.am_api_usage
  WHERE user_id IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'am_api_usage contains % rows without user_id. Map legacy global usage rows to accounts before applying account-scoped quota.',
      null_count;
  END IF;

  -- Remove a legacy PK/UNIQUE constraint that only keyed by usage_date.
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'am_api_usage'
      AND c.contype IN ('p', 'u')
      AND (
        SELECT count(*)
        FROM unnest(c.conkey) AS k(attnum)
        JOIN pg_attribute a
          ON a.attrelid = t.oid
         AND a.attnum = k.attnum
        WHERE a.attname = 'usage_date'
      ) = 1
      AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format(
      'ALTER TABLE public.am_api_usage DROP CONSTRAINT IF EXISTS %I',
      constraint_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.am_api_usage
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.am_api_usage
  DROP CONSTRAINT IF EXISTS am_api_usage_pkey;

ALTER TABLE public.am_api_usage
  ADD CONSTRAINT am_api_usage_pkey PRIMARY KEY (usage_date, user_id);

ALTER TABLE public.am_api_usage
  DROP CONSTRAINT IF EXISTS am_api_usage_user_id_fkey;

ALTER TABLE public.am_api_usage
  ADD CONSTRAINT am_api_usage_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Remove legacy global RPC signatures so they cannot be called accidentally.
DROP FUNCTION IF EXISTS public.reserve_api_usage(date, integer);
DROP FUNCTION IF EXISTS public.record_api_usage_result(date, boolean);
DROP FUNCTION IF EXISTS public.reserve_api_usage(uuid, date, integer);
DROP FUNCTION IF EXISTS public.record_api_usage_result(uuid, date, boolean);

-- Atomic reservation: one independent daily bucket per authenticated account.
CREATE FUNCTION public.reserve_api_usage(
  p_user_id uuid,
  p_usage_date date,
  p_daily_limit integer
)
RETURNS TABLE(
  usage_date date,
  request_count integer,
  success_count integer,
  failed_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_count integer;
  v_success_count integer;
  v_failed_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid user id';
  END IF;

  IF p_usage_date IS NULL THEN
    RAISE EXCEPTION 'Invalid usage date';
  END IF;

  IF p_daily_limit IS NULL OR p_daily_limit < 1 THEN
    RAISE EXCEPTION 'Invalid daily limit';
  END IF;

  INSERT INTO public.am_api_usage (
    usage_date,
    user_id,
    request_count,
    success_count,
    failed_count,
    updated_at
  )
  VALUES (
    p_usage_date,
    p_user_id,
    1,
    0,
    0,
    now()
  )
  ON CONFLICT (usage_date, user_id) DO UPDATE
  SET request_count = public.am_api_usage.request_count + 1,
      updated_at = now()
  WHERE public.am_api_usage.request_count < p_daily_limit
  RETURNING
    am_api_usage.request_count,
    am_api_usage.success_count,
    am_api_usage.failed_count
  INTO
    v_request_count,
    v_success_count,
    v_failed_count;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p_usage_date,
    v_request_count,
    v_success_count,
    v_failed_count;
END;
$$;

-- Result accounting remains scoped to the same account/day bucket.
CREATE FUNCTION public.record_api_usage_result(
  p_user_id uuid,
  p_usage_date date,
  p_success boolean
)
RETURNS TABLE(
  usage_date date,
  request_count integer,
  success_count integer,
  failed_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL OR p_usage_date IS NULL THEN
    RAISE EXCEPTION 'Invalid usage identity';
  END IF;

  RETURN QUERY
  UPDATE public.am_api_usage
  SET success_count = success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
      failed_count = failed_count + CASE WHEN p_success THEN 0 ELSE 1 END,
      updated_at = now()
  WHERE am_api_usage.usage_date = p_usage_date
    AND am_api_usage.user_id = p_user_id
  RETURNING
    am_api_usage.usage_date,
    am_api_usage.request_count,
    am_api_usage.success_count,
    am_api_usage.failed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_api_usage(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_api_usage_result(date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_api_usage(uuid, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_api_usage_result(uuid, date, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_api_usage(uuid, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_api_usage_result(uuid, date, boolean) TO service_role;
