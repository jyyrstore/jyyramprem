-- Portal Access Token Trial Modes V1
-- Adds 15-day, 30-day, and permanent Owner-generated portal access tokens.
-- Existing tokens keep their current expiry semantics.
BEGIN;

ALTER TABLE public.portal_access_tokens
  ADD COLUMN IF NOT EXISTS duration_mode text;

ALTER TABLE public.portal_access_tokens
  ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE public.portal_access_tokens
  DROP CONSTRAINT IF EXISTS portal_access_tokens_duration_mode_check;

ALTER TABLE public.portal_access_tokens
  ADD CONSTRAINT portal_access_tokens_duration_mode_check
  CHECK (duration_mode IS NULL OR duration_mode IN ('15_days', '30_days', 'permanent'));

ALTER TABLE public.portal_access_grants
  ALTER COLUMN expires_at DROP NOT NULL;

CREATE INDEX IF NOT EXISTS portal_access_tokens_duration_mode_idx
  ON public.portal_access_tokens(duration_mode, created_at DESC);

-- A NULL expiry means permanent access. Legacy rows with a concrete expiry
-- remain time-limited exactly as before.
CREATE OR REPLACE FUNCTION public.portal_has_access(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT m.status = 'active'
    FROM public.member_profiles m
    WHERE m.user_id = p_user_id
  ), true)
  AND EXISTS (
    SELECT 1
    FROM public.portal_access_grants g
    JOIN public.portal_access_tokens t ON t.id = g.token_id
    WHERE g.user_id = p_user_id
      AND t.status <> 'revoked'
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND (t.expires_at IS NULL OR t.expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_verify_token(p_user_id uuid, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token public.portal_access_tokens;
  v_now timestamptz := now();
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR length(trim(p_token_hash)) <> 64 THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  SELECT * INTO v_token
  FROM public.portal_access_tokens
  WHERE token_hash = lower(trim(p_token_hash))
  LIMIT 1
  FOR UPDATE;

  IF v_token.id IS NULL
     OR v_token.status <> 'active'
     OR v_token.used_at IS NOT NULL
     OR (v_token.expires_at IS NOT NULL AND v_token.expires_at <= v_now) THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  INSERT INTO public.portal_access_grants(user_id, token_id, granted_at, expires_at, last_verified_at)
  VALUES (p_user_id, v_token.id, v_now, v_token.expires_at, v_now)
  ON CONFLICT (user_id) DO UPDATE SET
    token_id = EXCLUDED.token_id,
    granted_at = EXCLUDED.granted_at,
    expires_at = EXCLUDED.expires_at,
    last_verified_at = EXCLUDED.last_verified_at;

  UPDATE public.portal_access_tokens
  SET used_at = v_now, status = 'used'
  WHERE id = v_token.id AND status = 'active' AND used_at IS NULL;

  UPDATE public.portal_token_requests
  SET status = 'fulfilled', resolved_at = v_now, resolved_by = v_token.created_by
  WHERE user_id = p_user_id AND status = 'pending';

  RETURN jsonb_build_object(
    'valid', true,
    'expires_at', v_token.expires_at,
    'duration_mode', coalesce(v_token.duration_mode, 'legacy')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_portal_token_status(p_owner_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v jsonb;
  v_active_count bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.portal_access_tokens
  WHERE status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  SELECT jsonb_build_object(
    'id', id,
    'status', CASE
      WHEN status = 'active' AND (expires_at IS NULL OR expires_at > now()) THEN 'active'
      ELSE 'expired'
    END,
    'expires_at', expires_at,
    'created_at', created_at,
    'duration_mode', duration_mode
  ) INTO v
  FROM public.portal_access_tokens
  WHERE status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'token', coalesce(v, jsonb_build_object('status', 'none')),
    'active_count', v_active_count
  );
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT proname, pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND proname IN (
        'portal_has_access',
        'portal_verify_token',
        'owner_create_portal_token',
        'owner_get_portal_token_status'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname, r.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      r.proname, r.args
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
