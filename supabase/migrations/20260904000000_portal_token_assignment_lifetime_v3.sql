-- Canonical portal token assignment + lifetime contract V3
--
-- Single source of truth:
--   portal_access_tokens.assigned_user_id + expires_at + duration_mode
--
-- Access grants remain a separate 24-hour redemption window. Token lifetime
-- never resets on login/refresh and never counts down a mutable day counter.
BEGIN;

ALTER TABLE public.portal_access_tokens
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS token_encrypted text,
  ADD COLUMN IF NOT EXISTS token_preview text,
  ADD COLUMN IF NOT EXISTS used_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_mode text;

ALTER TABLE public.portal_access_tokens
  ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE public.portal_access_tokens
  DROP CONSTRAINT IF EXISTS portal_access_tokens_duration_mode_check;
ALTER TABLE public.portal_access_tokens
  ADD CONSTRAINT portal_access_tokens_duration_mode_check
  CHECK (duration_mode IS NULL OR duration_mode IN ('15_days','30_days','permanent'));

CREATE INDEX IF NOT EXISTS portal_access_tokens_assigned_user_idx
  ON public.portal_access_tokens(assigned_user_id, created_at DESC);

-- Backfill the canonical assignment for historical redeemed tokens.
UPDATE public.portal_access_tokens t
   SET assigned_user_id = g.user_id
  FROM public.portal_access_grants g
 WHERE t.id = g.token_id
   AND t.assigned_user_id IS NULL;

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
       AND (t.expires_at IS NULL OR t.expires_at > now())
       AND (g.expires_at IS NULL OR g.expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_get_token_lifetime(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token public.portal_access_tokens;
  v_grant public.portal_access_grants;
  v_status text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('token', NULL);
  END IF;

  -- Canonical relationship for new tokens.
  SELECT * INTO v_token
    FROM public.portal_access_tokens
   WHERE assigned_user_id = p_user_id
   ORDER BY created_at DESC
   LIMIT 1;

  -- Legacy fallback: resolve grant -> token, then continue using token.expires_at.
  IF v_token.id IS NULL THEN
    SELECT * INTO v_grant
      FROM public.portal_access_grants
     WHERE user_id = p_user_id
     ORDER BY granted_at DESC
     LIMIT 1;
    IF v_grant.token_id IS NOT NULL THEN
      SELECT * INTO v_token
        FROM public.portal_access_tokens
       WHERE id = v_grant.token_id
       LIMIT 1;
    END IF;
  ELSE
    SELECT * INTO v_grant
      FROM public.portal_access_grants
     WHERE user_id = p_user_id
       AND token_id = v_token.id
     ORDER BY granted_at DESC
     LIMIT 1;
  END IF;

  IF v_token.id IS NULL THEN
    RETURN jsonb_build_object('token', NULL);
  END IF;

  IF v_token.expires_at IS NOT NULL AND v_token.expires_at <= now() THEN
    v_status := 'expired';
  ELSIF v_token.status = 'revoked' THEN
    v_status := 'revoked';
  ELSE
    v_status := 'active';
  END IF;

  RETURN jsonb_build_object(
    'token', jsonb_build_object(
      'token_id', v_token.id,
      'duration_mode', coalesce(v_token.duration_mode, 'legacy'),
      'expires_at', v_token.expires_at,
      'status', v_status,
      'created_at', v_token.created_at,
      'used_at', v_token.used_at,
      'grant_expires_at', v_grant.expires_at,
      'grant_granted_at', v_grant.granted_at,
      'is_permanent', (v_token.duration_mode = 'permanent' AND v_token.expires_at IS NULL),
      'source', CASE WHEN v_token.assigned_user_id IS NULL THEN 'legacy_grant' ELSE 'assigned_token' END
    )
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
  v_grant_expires_at timestamptz;
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
     OR (v_token.expires_at IS NOT NULL AND v_token.expires_at <= v_now)
     OR (v_token.assigned_user_id IS NOT NULL AND v_token.assigned_user_id <> p_user_id) THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  -- Legacy tokens can be adopted by their first successful redeemer. New
  -- tokens are already assigned and must match exactly.
  IF v_token.assigned_user_id IS NULL THEN
    UPDATE public.portal_access_tokens
       SET assigned_user_id = p_user_id
     WHERE id = v_token.id
       AND assigned_user_id IS NULL;
  END IF;

  v_grant_expires_at := v_now + interval '24 hours';
  IF v_token.expires_at IS NOT NULL AND v_token.expires_at < v_grant_expires_at THEN
    v_grant_expires_at := v_token.expires_at;
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

  UPDATE public.portal_access_tokens
     SET used_at = v_now, status = 'used'
   WHERE id = v_token.id
     AND status = 'active'
     AND used_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or already used token';
  END IF;

  UPDATE public.portal_token_requests
     SET status = 'fulfilled', resolved_at = v_now, resolved_by = v_token.created_by
   WHERE user_id = p_user_id
     AND status = 'pending';

  RETURN jsonb_build_object(
    'valid', true,
    'expires_at', v_token.expires_at,
    'token_expires_at', v_token.expires_at,
    'grant_expires_at', v_grant_expires_at,
    'duration_mode', coalesce(v_token.duration_mode, 'legacy')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_create_portal_token(
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
  v_user_id uuid;
  v_request_id uuid;
  v_email text;
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

  -- Serialize assignment so two simultaneous Owner requests cannot consume
  -- the same pending member request. Existing active tokens remain independent.
  SELECT r.id, r.user_id, u.email
    INTO v_request_id, v_user_id, v_email
    FROM public.portal_token_requests r
    JOIN auth.users u ON u.id = r.user_id
   WHERE r.status = 'pending'
   ORDER BY r.created_at ASC
   LIMIT 1
   FOR UPDATE OF r SKIP LOCKED;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No pending token request';
  END IF;

  INSERT INTO public.portal_access_tokens(
    token_hash, token_preview, token_encrypted, status, expires_at,
    created_by, assigned_user_id, duration_mode
  )
  VALUES (
    lower(trim(p_token_hash)), trim(p_token_preview), trim(p_token_encrypted),
    'active', p_expires_at, p_owner_user_id, v_user_id, NULLIF(v_mode, 'legacy')
  )
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN jsonb_build_object(
    'id', v_id,
    'created_at', v_created_at,
    'expires_at', p_expires_at,
    'status', 'active',
    'assigned_user_id', v_user_id,
    'assigned_email', v_email,
    'request_id', v_request_id,
    'duration_mode', NULLIF(v_mode, 'legacy'),
    'token_encrypted', trim(p_token_encrypted)
  );
END;
$$;

-- The new six-argument function is the only creation contract used by the
-- application server. Keep older overloads unavailable to browser roles.
REVOKE ALL ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.portal_get_token_lifetime(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_token_lifetime(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.portal_verify_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_verify_token(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
