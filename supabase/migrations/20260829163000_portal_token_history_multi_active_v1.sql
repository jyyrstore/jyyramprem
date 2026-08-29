-- Portal token history + multiple independent active tokens.
-- Tokens remain valid until used, expired, or revoked. Plaintext is never persisted.
BEGIN;

ALTER TABLE public.portal_access_tokens
  ADD COLUMN IF NOT EXISTS token_preview text,
  ADD COLUMN IF NOT EXISTS used_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.portal_access_tokens'::regclass
      AND conname = 'portal_access_tokens_status_check'
  ) THEN
    ALTER TABLE public.portal_access_tokens DROP CONSTRAINT portal_access_tokens_status_check;
  END IF;
END $$;

ALTER TABLE public.portal_access_tokens
  ADD CONSTRAINT portal_access_tokens_status_check
  CHECK (status IN ('active','used','revoked'));

CREATE INDEX IF NOT EXISTS portal_access_tokens_created_at_idx
  ON public.portal_access_tokens(created_at DESC);
CREATE INDEX IF NOT EXISTS portal_access_tokens_used_at_idx
  ON public.portal_access_tokens(used_at DESC);

-- A token is single-use, but after it grants access the grant remains valid
-- until its own expiry. Therefore portal_has_access must not require the token
-- row itself to remain active.
CREATE OR REPLACE FUNCTION public.portal_has_access(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.portal_access_grants g
    WHERE g.user_id = p_user_id
      AND g.expires_at > now()
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
     OR v_token.expires_at <= v_now THEN
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

  RETURN jsonb_build_object('valid', true, 'expires_at', v_token.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_create_portal_token(
  p_owner_user_id uuid,
  p_token_hash text,
  p_token_preview text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_token_hash IS NULL OR length(trim(p_token_hash)) <> 64 THEN RAISE EXCEPTION 'Invalid token hash'; END IF;
  IF p_token_preview IS NULL OR length(trim(p_token_preview)) < 8 THEN RAISE EXCEPTION 'Invalid token preview'; END IF;
  IF p_expires_at <= now() THEN RAISE EXCEPTION 'Token expiry must be in the future'; END IF;

  -- IMPORTANT: do not revoke existing active tokens. Each generated token
  -- is independent and remains usable until used, expired, or revoked.
  INSERT INTO public.portal_access_tokens(token_hash, token_preview, status, expires_at, created_by)
  VALUES (lower(trim(p_token_hash)), trim(p_token_preview), 'active', p_expires_at, p_owner_user_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'expires_at', p_expires_at,
    'status', 'active'
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
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;

  SELECT count(*) INTO v_active_count
  FROM public.portal_access_tokens
  WHERE status = 'active' AND expires_at > now();

  SELECT jsonb_build_object(
    'id', id,
    'status', CASE WHEN status = 'active' AND expires_at > now() THEN 'active' ELSE 'expired' END,
    'expires_at', expires_at,
    'created_at', created_at,
    'preview', token_preview
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

CREATE OR REPLACE FUNCTION public.owner_list_portal_tokens(
  p_owner_user_id uuid,
  p_limit integer,
  p_offset integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
  v_total bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN RAISE EXCEPTION 'Invalid offset'; END IF;

  SELECT count(*) INTO v_total FROM public.portal_access_tokens;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      t.id,
      t.token_preview AS preview,
      CASE
        WHEN t.status = 'active' AND t.expires_at <= now() THEN 'expired'
        ELSE t.status
      END AS status,
      t.created_at,
      t.expires_at,
      t.used_at,
      t.revoked_at,
      u.email AS used_email
    FROM public.portal_access_tokens t
    LEFT JOIN public.portal_access_grants g ON g.token_id = t.id
    LEFT JOIN auth.users u ON u.id = g.user_id
    ORDER BY t.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) x;

  RETURN jsonb_build_object(
    'tokens', v_rows,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
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
        'owner_get_portal_token_status',
        'owner_list_portal_tokens'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
  END LOOP;
END;
$$;

COMMIT;
