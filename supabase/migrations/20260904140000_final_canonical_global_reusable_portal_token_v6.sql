-- FINAL CANONICAL PORTAL CONTRACT V6
-- Global reusable Owner tokens + fixed 24h user grants.
-- Request/assignment queue is retired from runtime; historical request rows/table
-- remain intact for data preservation and audit history.
BEGIN;

-- ------------------------------------------------------------
-- 1. Canonical Owner token creation: exactly one 6-argument signature.
-- ------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, oidvectortypes(p.proargtypes) AS argtypes
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'owner_create_portal_token'
      AND p.prokind = 'f'
  LOOP
    IF r.argtypes <> 'uuid, text, text, text, timestamp with time zone, text' THEN
      EXECUTE format('DROP FUNCTION public.owner_create_portal_token(%s)', r.argtypes);
    END IF;
  END LOOP;
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
  v_created_at timestamptz;
  v_mode text := lower(trim(coalesce(p_duration_mode, '')));
  v_expected_expires_at timestamptz;
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
  IF v_mode NOT IN ('15_days', '30_days', 'permanent') THEN
    RAISE EXCEPTION 'Invalid token duration mode';
  END IF;

  v_expected_expires_at := CASE v_mode
    WHEN '15_days' THEN now() + interval '15 days'
    WHEN '30_days' THEN now() + interval '30 days'
    WHEN 'permanent' THEN NULL
  END;

  IF v_mode = 'permanent' AND p_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'Permanent token must have null expiry';
  END IF;

  IF v_mode IN ('15_days', '30_days') THEN
    IF p_expires_at IS NULL OR p_expires_at <= now() THEN
      RAISE EXCEPTION 'Finite token must have a future expiry';
    END IF;
    -- The server owns the exact creation timestamp calculation; permit only a
    -- small clock-skew window while still rejecting arbitrary TTL injection.
    IF abs(extract(epoch from (p_expires_at - v_expected_expires_at))) > 60 THEN
      RAISE EXCEPTION 'Token expiry does not match duration mode';
    END IF;
  END IF;

  INSERT INTO public.portal_access_tokens(
    token_hash,
    token_preview,
    token_encrypted,
    duration_mode,
    status,
    expires_at,
    created_by,
    assigned_user_id,
    assigned_request_id,
    used_at
  )
  VALUES (
    lower(trim(p_token_hash)),
    trim(p_token_preview),
    trim(p_token_encrypted),
    v_mode,
    'active',
    p_expires_at,
    p_owner_user_id,
    NULL,
    NULL,
    NULL
  )
  RETURNING id, created_at INTO v_id, v_created_at;

  RETURN jsonb_build_object(
    'id', v_id,
    'created_at', v_created_at,
    'status', 'active',
    'duration_mode', v_mode,
    'expires_at', p_expires_at,
    'global', true,
    'reusable', true,
    'grant_lifetime_hours', 24,
    'token_encrypted', trim(p_token_encrypted)
  );
END;
$$;

-- ------------------------------------------------------------
-- 2. Canonical token lifetime lookup for Settings.
-- Token lifetime comes from token.expires_at only.
-- A member's grant is used only to resolve which global token they redeemed.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_get_token_lifetime();
DROP FUNCTION IF EXISTS public.portal_get_token_lifetime(uuid);

CREATE FUNCTION public.portal_get_token_lifetime(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH granted AS (
    SELECT t.id, t.duration_mode, t.expires_at, t.created_at, t.status
    FROM public.portal_access_grants g
    JOIN public.portal_access_tokens t ON t.id = g.token_id
    WHERE g.user_id = p_user_id
    ORDER BY g.granted_at DESC
    LIMIT 1
  ),
  newest AS (
    SELECT t.id, t.duration_mode, t.expires_at, t.created_at, t.status
    FROM public.portal_access_tokens t
    ORDER BY t.created_at DESC
    LIMIT 1
  ),
  chosen AS (
    SELECT * FROM granted
    UNION ALL
    SELECT * FROM newest WHERE NOT EXISTS (SELECT 1 FROM granted)
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'token',
    CASE
      WHEN chosen.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'token_id', chosen.id,
        'duration_mode', coalesce(chosen.duration_mode, 'legacy'),
        'expires_at', chosen.expires_at,
        'status', CASE
          WHEN chosen.status = 'revoked' THEN 'revoked'
          WHEN chosen.expires_at IS NULL OR chosen.expires_at > now() THEN 'active'
          ELSE 'expired'
        END,
        'created_at', chosen.created_at,
        'is_permanent', (chosen.duration_mode = 'permanent' AND chosen.expires_at IS NULL),
        'global', true,
        'reusable', true
      )
    END
  )
  FROM chosen;
$$;

-- ------------------------------------------------------------
-- 3. Canonical access authorization.
-- Active member + non-revoked token + active 24h grant.
-- Token expiry is NOT an access-expiry condition after redemption.
-- ------------------------------------------------------------
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
      AND g.expires_at > now()
  );
$$;

-- ------------------------------------------------------------
-- 4. Canonical redemption.
-- Token must still be active/unexpired at redemption.
-- Successful redemption always grants exactly 24h.
-- Token remains reusable and active; used_at/status are not consumed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_verify_token(p_user_id uuid, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token public.portal_access_tokens;
  v_member_status text;
  v_now timestamptz := now();
  v_grant_expires_at timestamptz := now() + interval '24 hours';
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR length(trim(p_token_hash)) <> 64 THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  SELECT coalesce(m.status, 'active')
  INTO v_member_status
  FROM public.member_profiles m
  WHERE m.user_id = p_user_id;

  IF v_member_status IN ('suspended', 'banned') THEN
    RAISE EXCEPTION 'Member access restricted';
  END IF;

  SELECT *
  INTO v_token
  FROM public.portal_access_tokens
  WHERE token_hash = lower(trim(p_token_hash))
  LIMIT 1
  FOR UPDATE;

  IF v_token.id IS NULL
     OR v_token.status <> 'active'
     OR (v_token.expires_at IS NOT NULL AND v_token.expires_at <= v_now) THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  INSERT INTO public.portal_access_grants(
    user_id, token_id, granted_at, expires_at, last_verified_at
  )
  VALUES (
    p_user_id, v_token.id, v_now, v_grant_expires_at, v_now
  )
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
    'global', true,
    'reusable', true,
    'grant_lifetime_hours', 24
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. FAQ / Help public read RPCs.
-- Match the actual production table columns: published.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_list_faq()
RETURNS SETOF public.owner_faq
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.*
  FROM public.owner_faq f
  WHERE coalesce(f.published, true)
  ORDER BY coalesce(f.sort_order, 0), f.created_at;
$$;

CREATE OR REPLACE FUNCTION public.public_list_help()
RETURNS SETOF public.owner_help_articles
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT h.*
  FROM public.owner_help_articles h
  WHERE coalesce(h.published, true)
  ORDER BY coalesce(h.sort_order, 0), h.created_at;
$$;

-- ------------------------------------------------------------
-- 6. Request/assignment queue is no longer runtime.
-- Keep the table and historical columns for data preservation,
-- but retire the runtime RPCs.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_request_token(uuid);
DROP FUNCTION IF EXISTS public.owner_list_token_requests(uuid, integer, integer);

-- ------------------------------------------------------------
-- 7. Privilege hardening.
-- All server-only functions stay service_role-only.
-- Public FAQ/Help are also accessed through the trusted backend.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.portal_get_token_lifetime(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_token_lifetime(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.portal_has_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_has_access(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.portal_verify_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_verify_token(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.public_list_faq() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_list_faq() TO service_role;

REVOKE ALL ON FUNCTION public.public_list_help() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_list_help() TO service_role;

REVOKE ALL ON FUNCTION public.is_owner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO service_role;

-- Make the owner-check helper itself safe as a SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.is_owner(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.owner_lock
    WHERE id = true AND owner_user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_owner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
