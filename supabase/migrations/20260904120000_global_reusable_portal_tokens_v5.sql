-- Global reusable portal tokens V5
-- Owner creates one token; any authenticated user may redeem it repeatedly.
BEGIN;

DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, text, text, timestamptz, text, uuid);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(timestamptz, uuid, text, text);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, timestamptz, text);

CREATE FUNCTION public.owner_create_portal_token(
  p_owner_user_id uuid,
  p_token_hash text,
  p_token_preview text,
  p_token_encrypted text,
  p_expires_at timestamptz,
  p_duration_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_mode text;
  v_created_at timestamptz;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF p_token_hash IS NULL OR length(trim(p_token_hash)) <> 64 THEN
    RAISE EXCEPTION 'Invalid token hash';
  END IF;
  IF p_token_preview IS NULL OR length(trim(p_token_preview)) < 8 THEN
    RAISE EXCEPTION 'Invalid token preview';
  END IF;
  IF p_token_encrypted IS NULL OR length(trim(p_token_encrypted)) < 24 THEN
    RAISE EXCEPTION 'Invalid encrypted token';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'Token expiry must be in the future';
  END IF;

  v_mode := lower(trim(coalesce(p_duration_mode, 'legacy')));
  IF v_mode NOT IN ('15_days','30_days','permanent','legacy') THEN
    RAISE EXCEPTION 'Invalid token duration mode';
  END IF;
  IF v_mode = 'permanent' AND p_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'Permanent token must have null expiry';
  END IF;
  IF v_mode IN ('15_days','30_days') AND p_expires_at IS NULL THEN
    RAISE EXCEPTION 'Finite token must have an expiry';
  END IF;

  INSERT INTO public.portal_access_tokens(
    token_hash, token_preview, token_encrypted, status, expires_at, created_by,
    assigned_user_id, assigned_request_id, duration_mode
  )
  VALUES (
    lower(trim(p_token_hash)), trim(p_token_preview), trim(p_token_encrypted),
    'active', p_expires_at, p_owner_user_id, NULL, NULL, NULLIF(v_mode, 'legacy')
  )
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN jsonb_build_object(
    'id', v_id,
    'created_at', v_created_at,
    'expires_at', p_expires_at,
    'status', 'active',
    'assigned_user_id', NULL,
    'request_id', NULL,
    'duration_mode', NULLIF(v_mode, 'legacy'),
    'token_encrypted', trim(p_token_encrypted),
    'reusable', true
  );
END;
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
  v_grant_expires_at timestamptz := v_now + interval '24 hours';
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR length(trim(p_token_hash)) <> 64 THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  SELECT * INTO v_token
    FROM public.portal_access_tokens
   WHERE token_hash = lower(trim(p_token_hash))
   LIMIT 1;

  IF v_token.id IS NULL
     OR v_token.status <> 'active'
     OR (v_token.expires_at IS NOT NULL AND v_token.expires_at <= v_now) THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  INSERT INTO public.portal_access_grants(
    user_id, token_id, granted_at, expires_at, last_verified_at
  )
  VALUES (p_user_id, v_token.id, v_now, v_grant_expires_at, v_now)
  ON CONFLICT (user_id) DO UPDATE SET
    token_id = EXCLUDED.token_id,
    granted_at = EXCLUDED.granted_at,
    expires_at = EXCLUDED.expires_at,
    last_verified_at = EXCLUDED.last_verified_at;

  RETURN jsonb_build_object(
    'valid', true,
    'token_expires_at', v_token.expires_at,
    'grant_expires_at', v_grant_expires_at,
    'duration_mode', coalesce(v_token.duration_mode, 'legacy'),
    'reusable', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text) TO service_role;
REVOKE ALL ON FUNCTION public.portal_verify_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_verify_token(uuid, text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
