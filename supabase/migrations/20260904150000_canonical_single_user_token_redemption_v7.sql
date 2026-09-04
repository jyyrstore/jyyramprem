-- FINAL CANONICAL PORTAL TOKEN CONTRACT V7
--
-- Business contract (authoritative):
--   1 TOKEN = 1 USER
--
-- 1. Every newly generated token has exactly a 24-hour redemption window.
-- 2. The first successful redemption atomically assigns that token to one user.
-- 3. A redeemed token is never redeemable by another user.
-- 4. After redemption, user access lifetime is determined by duration_mode:
--      15_days  -> redemption + 15 days
--      30_days  -> redemption + 30 days
--      permanent -> no access expiry (NULL)
-- 5. Redemption lifetime and user-access lifetime are separate concepts.
-- 6. Historical access grants are preserved; this migration does not extend
--    existing user access merely because a token carries a 15/30-day mode.
-- 7. Token history is retained. Revocation is non-destructive.
--
-- This migration supersedes the previous V4/V5/V6 global-reusable semantics.

BEGIN;

-- ============================================================================
-- 1. Canonical columns
-- ============================================================================

ALTER TABLE public.portal_access_tokens
  ADD COLUMN IF NOT EXISTS redemption_expires_at timestamptz;

ALTER TABLE public.portal_access_grants
  ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;

ALTER TABLE public.portal_access_tokens
  DROP CONSTRAINT IF EXISTS portal_access_tokens_status_check;

ALTER TABLE public.portal_access_tokens
  DROP CONSTRAINT IF EXISTS portal_access_tokens_assignment_state_check;

-- Keep the old expires_at columns for compatibility/history. Runtime below
-- uses redemption_expires_at for unused-token redemption and
-- access_expires_at for post-redemption authorization.

-- ============================================================================
-- 2. Historical-data normalization
-- ============================================================================

-- 2A. Adopt a historical token only when its old grants identify exactly one
--     redeemer. This is deterministic and preserves the real user assignment.
WITH token_users AS (
  SELECT
    g.token_id,
    (array_agg(g.user_id ORDER BY g.granted_at, g.user_id))[1] AS user_id,
    min(g.granted_at) AS first_granted_at
  FROM public.portal_access_grants g
  GROUP BY g.token_id
  HAVING count(DISTINCT g.user_id) = 1
)
UPDATE public.portal_access_tokens t
SET assigned_user_id = tu.user_id,
    used_at = COALESCE(t.used_at, tu.first_granted_at),
    status = CASE
      WHEN t.status = 'revoked' THEN 'revoked'
      ELSE 'used'
    END
FROM token_users tu
WHERE t.id = tu.token_id
  AND t.assigned_user_id IS NULL;

-- 2B. A token with old grants for multiple users cannot satisfy the new
--     one-token/one-user invariant. Do not guess an owner. Revoke only the
--     token; all historical grant rows are retained for audit/history.
UPDATE public.portal_access_tokens t
SET status = 'revoked',
    revoked_at = COALESCE(t.revoked_at, now()),
    revoked_by = COALESCE(t.revoked_by, t.created_by)
WHERE t.assigned_user_id IS NULL
  AND t.status <> 'revoked'
  AND EXISTS (
    SELECT 1
    FROM public.portal_access_grants g
    WHERE g.token_id = t.id
    GROUP BY g.token_id
    HAVING count(DISTINCT g.user_id) > 1
  );

-- 2C. Active + used_at but no user means the token was consumed by an older
--     flow without a durable assignment. It cannot safely be revived and must
--     not violate the final state invariant. Preserve it as revoked history.
UPDATE public.portal_access_tokens
SET status = 'revoked',
    revoked_at = COALESCE(revoked_at, now()),
    revoked_by = COALESCE(revoked_by, created_by)
WHERE status = 'active'
  AND assigned_user_id IS NULL
  AND used_at IS NOT NULL;

-- 2D. Every token now gets a deterministic 24-hour redemption deadline based
--     on creation time. For redeemed/revoked tokens this is historical data;
--     for unused tokens this is the actual eligibility deadline.
UPDATE public.portal_access_tokens
SET redemption_expires_at = created_at + interval '24 hours'
WHERE redemption_expires_at IS NULL;

ALTER TABLE public.portal_access_tokens
  ALTER COLUMN redemption_expires_at SET NOT NULL;

ALTER TABLE public.portal_access_tokens
  DROP CONSTRAINT IF EXISTS portal_access_tokens_redeem_window_check;

ALTER TABLE public.portal_access_tokens
  ADD CONSTRAINT portal_access_tokens_redeem_window_check
  CHECK (redemption_expires_at > created_at);

-- 2E. Preserve historical user-access expiry exactly as it existed before this
--     migration. Do NOT retroactively convert a prior 24h grant into 15/30d.
UPDATE public.portal_access_grants g
SET access_expires_at = g.expires_at
WHERE g.access_expires_at IS NULL
   OR g.access_expires_at IS DISTINCT FROM g.expires_at;

-- For compatibility, keep the legacy grant expiry column mirrored.
UPDATE public.portal_access_grants
SET expires_at = access_expires_at
WHERE expires_at IS DISTINCT FROM access_expires_at;

-- 2F. Materialize expired unused tokens. They remain in history and cannot be
--     redeemed again.
UPDATE public.portal_access_tokens
SET status = 'expired'
WHERE status = 'active'
  AND assigned_user_id IS NULL
  AND used_at IS NULL
  AND redemption_expires_at <= now();

-- 2G. Any assigned token is definitively a used token. This also repairs older
--     rows where the assignment existed but status was left as active.
UPDATE public.portal_access_tokens
SET used_at = COALESCE(used_at, (
      SELECT min(g.granted_at)
      FROM public.portal_access_grants g
      WHERE g.token_id = public.portal_access_tokens.id
    ), now()),
    status = CASE
      WHEN status = 'revoked' THEN 'revoked'
      ELSE 'used'
    END
WHERE assigned_user_id IS NOT NULL;

-- Recheck historical ambiguous rows after normalization. A token may now be
-- revoked, assigned, or cleanly available.

ALTER TABLE public.portal_access_tokens
  ADD CONSTRAINT portal_access_tokens_status_check
  CHECK (status IN ('active','used','expired','revoked'));

ALTER TABLE public.portal_access_tokens
  DROP CONSTRAINT IF EXISTS portal_access_tokens_duration_mode_check;

ALTER TABLE public.portal_access_tokens
  ADD CONSTRAINT portal_access_tokens_duration_mode_check
  CHECK (duration_mode IS NULL OR duration_mode IN ('15_days','30_days','permanent'));

ALTER TABLE public.portal_access_tokens
  ADD CONSTRAINT portal_access_tokens_assignment_state_check
  CHECK (
    status = 'revoked'
    OR (status IN ('active','expired') AND assigned_user_id IS NULL AND used_at IS NULL)
    OR (status = 'used' AND assigned_user_id IS NOT NULL AND used_at IS NOT NULL)
  );

-- ============================================================================
-- 3. Canonical indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS portal_access_tokens_redemption_state_idx
  ON public.portal_access_tokens(status, redemption_expires_at, created_at DESC);

CREATE INDEX IF NOT EXISTS portal_access_tokens_assigned_user_idx
  ON public.portal_access_tokens(assigned_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS portal_access_grants_access_expiry_idx
  ON public.portal_access_grants(user_id, access_expires_at);

-- token_hash is already UNIQUE from the base schema, which is the lookup and
-- concurrency key used by redemption.

-- ============================================================================
-- 4. Remove obsolete owner-creation overloads and create one canonical RPC
-- ============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'owner_create_portal_token'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('DROP FUNCTION public.owner_create_portal_token(%s)', r.args);
  END LOOP;
END;
$$;

CREATE FUNCTION public.owner_create_portal_token(
  p_owner_user_id uuid,
  p_token_hash text,
  p_token_preview text,
  p_token_encrypted text,
  p_duration_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_created_at timestamptz := now();
  v_redemption_expires_at timestamptz := v_created_at + interval '24 hours';
  v_mode text := lower(trim(coalesce(p_duration_mode, '')));
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

  IF v_mode NOT IN ('15_days','30_days','permanent') THEN
    RAISE EXCEPTION 'Invalid token duration mode';
  END IF;

  INSERT INTO public.portal_access_tokens(
    token_hash,
    token_preview,
    token_encrypted,
    duration_mode,
    status,
    redemption_expires_at,
    expires_at,
    created_by,
    created_at,
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
    v_redemption_expires_at,
    v_redemption_expires_at,
    p_owner_user_id,
    v_created_at,
    NULL,
    NULL,
    NULL
  )
  RETURNING id, created_at
  INTO v_id, v_created_at;

  RETURN jsonb_build_object(
    'id', v_id,
    'created_at', v_created_at,
    'status', 'active',
    'duration_mode', v_mode,
    'redemption_expires_at', v_redemption_expires_at,
    'expires_at', v_redemption_expires_at,
    'assigned_user_id', NULL,
    'used_at', NULL,
    'token_encrypted', trim(p_token_encrypted)
  );
END;
$$;

COMMENT ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, text)
IS 'Canonical Owner token generation: all tokens have a 24-hour redemption window; duration_mode controls post-redemption user access.';

-- ============================================================================
-- 5. Canonical redemption: one token -> one user, atomically
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_verify_token(
  p_user_id uuid,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token public.portal_access_tokens;
  v_now timestamptz := now();
  v_access_expires_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR length(trim(p_token_hash)) <> 64 THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  IF public.is_owner(p_user_id) THEN
    RAISE EXCEPTION 'Owner does not use portal tokens';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.member_profiles m
    WHERE m.user_id = p_user_id
      AND m.status IN ('suspended','banned')
  ) THEN
    RAISE EXCEPTION 'Member access restricted';
  END IF;

  -- This row lock is the concurrency boundary. The first committed redeemer
  -- wins; a competing transaction cannot assign the same token to two users.
  SELECT *
  INTO v_token
  FROM public.portal_access_tokens
  WHERE token_hash = lower(trim(p_token_hash))
  LIMIT 1
  FOR UPDATE;

  IF v_token.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  -- Unused token: its 24-hour redemption window controls eligibility.
  IF v_token.status = 'active'
     AND v_token.assigned_user_id IS NULL
     AND v_token.used_at IS NULL
     AND v_token.redemption_expires_at <= v_now THEN
    UPDATE public.portal_access_tokens
    SET status = 'expired'
    WHERE id = v_token.id
      AND status = 'active'
      AND assigned_user_id IS NULL
      AND used_at IS NULL;

    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  IF v_token.status <> 'active'
     OR v_token.assigned_user_id IS NOT NULL
     OR v_token.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Token already used, revoked, or expired';
  END IF;

  v_access_expires_at := CASE v_token.duration_mode
    WHEN '15_days' THEN v_now + interval '15 days'
    WHEN '30_days' THEN v_now + interval '30 days'
    WHEN 'permanent' THEN NULL
    ELSE NULL
  END;

  IF v_token.duration_mode IS NULL THEN
    RAISE EXCEPTION 'Token duration mode is invalid';
  END IF;

  -- Only this successful path may populate assigned_user_id.
  UPDATE public.portal_access_tokens
  SET assigned_user_id = p_user_id,
      used_at = v_now,
      status = 'used'
  WHERE id = v_token.id
    AND status = 'active'
    AND assigned_user_id IS NULL
    AND used_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token already used, revoked, or expired';
  END IF;

  INSERT INTO public.portal_access_grants(
    user_id,
    token_id,
    granted_at,
    access_expires_at,
    expires_at,
    last_verified_at
  )
  VALUES (
    p_user_id,
    v_token.id,
    v_now,
    v_access_expires_at,
    v_access_expires_at,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    token_id = EXCLUDED.token_id,
    granted_at = EXCLUDED.granted_at,
    access_expires_at = EXCLUDED.access_expires_at,
    expires_at = EXCLUDED.expires_at,
    last_verified_at = EXCLUDED.last_verified_at;

  -- Historical request queue is no longer runtime-critical. If a legacy
  -- pending request exists, close it without generating another token.
  UPDATE public.portal_token_requests
  SET status = 'fulfilled',
      resolved_at = v_now,
      resolved_by = v_token.created_by
  WHERE user_id = p_user_id
    AND status = 'pending';

  RETURN jsonb_build_object(
    'valid', true,
    'token_id', v_token.id,
    'duration_mode', v_token.duration_mode,
    'redemption_expires_at', v_token.redemption_expires_at,
    'redeemed_at', v_now,
    'assigned_user_id', p_user_id,
    'access_expires_at', v_access_expires_at,
    'permanent', v_access_expires_at IS NULL
  );
END;
$$;

COMMENT ON FUNCTION public.portal_verify_token(uuid, text)
IS 'Canonical atomic token redemption: one token can be assigned to exactly one user; 24h redemption window, then 15d/30d/permanent access by token mode.';

-- ============================================================================
-- 6. Canonical access authorization
-- ============================================================================

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
      AND t.status = 'used'
      AND t.assigned_user_id = p_user_id
      AND (g.access_expires_at IS NULL OR g.access_expires_at > now())
  );
$$;

COMMENT ON FUNCTION public.portal_has_access(uuid)
IS 'Authorizes portal access from the assigned token grant only; token redemption expiry is irrelevant after successful redemption, except token revocation/status.';

-- ============================================================================
-- 7. Settings lifetime lookup: never expose another user''s token
-- ============================================================================

DROP FUNCTION IF EXISTS public.portal_get_token_lifetime();
DROP FUNCTION IF EXISTS public.portal_get_token_lifetime(uuid);

CREATE FUNCTION public.portal_get_token_lifetime(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'token',
    CASE
      WHEN t.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'token_id', t.id,
        'duration_mode', t.duration_mode,
        'status', CASE
          WHEN t.status = 'revoked' THEN 'revoked'
          WHEN g.access_expires_at IS NOT NULL AND g.access_expires_at <= now() THEN 'expired'
          WHEN t.status = 'used' THEN 'active'
          ELSE t.status
        END,
        'created_at', t.created_at,
        'redeemed_at', t.used_at,
        'redemption_expires_at', t.redemption_expires_at,
        'access_expires_at', g.access_expires_at,
        'is_permanent', (t.duration_mode = 'permanent' AND g.access_expires_at IS NULL),
        'assigned_user_id', t.assigned_user_id
      )
    END
  )
  FROM public.portal_access_grants g
  JOIN public.portal_access_tokens t
    ON t.id = g.token_id
   AND t.assigned_user_id = p_user_id
  WHERE g.user_id = p_user_id;
$$;

-- ============================================================================
-- 8. Owner status/history semantics
-- ============================================================================

CREATE OR REPLACE FUNCTION public.owner_get_portal_token_status(p_owner_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token jsonb;
  v_available_count bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;

  SELECT count(*)
  INTO v_available_count
  FROM public.portal_access_tokens
  WHERE status = 'active'
    AND assigned_user_id IS NULL
    AND used_at IS NULL
    AND redemption_expires_at > now();

  SELECT jsonb_build_object(
    'id', t.id,
    'status', CASE
      WHEN t.status = 'active'
       AND t.assigned_user_id IS NULL
       AND t.used_at IS NULL
       AND t.redemption_expires_at > now() THEN 'active'
      WHEN t.status = 'active'
       AND t.assigned_user_id IS NULL THEN 'expired'
      WHEN t.status = 'used' THEN 'used'
      ELSE t.status
    END,
    'duration_mode', t.duration_mode,
    'created_at', t.created_at,
    'redemption_expires_at', t.redemption_expires_at,
    'access_expires_at', g.access_expires_at,
    'assigned_user_id', t.assigned_user_id,
    'used_at', t.used_at
  )
  INTO v_token
  FROM public.portal_access_tokens t
  LEFT JOIN public.portal_access_grants g
    ON g.token_id = t.id
   AND g.user_id = t.assigned_user_id
  ORDER BY t.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'token', coalesce(v_token, jsonb_build_object('status','none')),
    'available_count', v_available_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_revoke_portal_token(
  p_owner_user_id uuid,
  p_token_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;

  UPDATE public.portal_access_tokens
  SET status = 'revoked',
      revoked_at = COALESCE(revoked_at, now()),
      revoked_by = p_owner_user_id
  WHERE id = p_token_id
    AND status IN ('active','used');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

-- ============================================================================
-- 9. Retire the old member request/Owner assignment queue from runtime
-- ============================================================================

DROP FUNCTION IF EXISTS public.portal_request_token(uuid);
DROP FUNCTION IF EXISTS public.owner_list_token_requests(uuid, integer, integer);

-- Preserve the request table and its history. No data is deleted here.

-- ============================================================================
-- 10. Security / RLS
-- ============================================================================

ALTER TABLE public.portal_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_token_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.portal_access_tokens, public.portal_access_grants, public.portal_token_requests
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'owner_create_portal_token',
        'owner_revoke_portal_token',
        'owner_get_portal_token_status',
        'portal_get_token_lifetime',
        'portal_has_access',
        'portal_verify_token',
        'portal_request_token',
        'owner_list_token_requests'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname,
      r.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      r.proname,
      r.args
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
