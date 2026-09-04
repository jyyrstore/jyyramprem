-- Canonical portal token/access contract: global reusable Owner tokens
--
-- Final rules:
--   1. Token lifetime belongs exclusively to portal_access_tokens.expires_at.
--   2. A successful redemption grants exactly 24h of portal access.
--   3. Owner-generated tokens are reusable by every authenticated user.
--   4. The same token stays active until expiry or Owner revocation.
--   5. Historical assignment fields remain only for compatibility with older rows.
--   6. Historical owner_create_portal_token overloads are removed so the
--      six-argument creation RPC is the only Owner generation contract.
BEGIN;

-- Extend request state so generation itself is a durable assignment event.
ALTER TABLE public.portal_token_requests
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_token_id uuid;

ALTER TABLE public.portal_token_requests
  DROP CONSTRAINT IF EXISTS portal_token_requests_status_check;
ALTER TABLE public.portal_token_requests
  ADD CONSTRAINT portal_token_requests_status_check
  CHECK (status IN ('pending','assigned','fulfilled','cancelled'));

DROP INDEX IF EXISTS public.portal_token_requests_one_pending_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS portal_token_requests_one_open_per_user
  ON public.portal_token_requests(user_id)
  WHERE status IN ('pending','assigned');

-- Bind each newly generated token to the exact request that selected it.
ALTER TABLE public.portal_access_tokens
  ADD COLUMN IF NOT EXISTS assigned_request_id uuid REFERENCES public.portal_token_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS portal_access_tokens_one_request_assignment_idx
  ON public.portal_access_tokens(assigned_request_id)
  WHERE assigned_request_id IS NOT NULL;

ALTER TABLE public.portal_token_requests
  DROP CONSTRAINT IF EXISTS portal_token_requests_assigned_token_fkey;
ALTER TABLE public.portal_token_requests
  ADD CONSTRAINT portal_token_requests_assigned_token_fkey
  FOREIGN KEY (assigned_token_id) REFERENCES public.portal_access_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS portal_token_requests_assigned_token_idx
  ON public.portal_token_requests(assigned_token_id);

-- -------------------------------------------------------------------------
-- ACCESS AUTHORIZATION: grant lifetime is authoritative after redemption.
-- Token expiry is intentionally NOT checked here because a token may expire
-- after redemption while its 24-hour access grant remains valid.
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- MEMBER REQUEST: do not create duplicate open requests. If a request is
-- already assigned, return that assignment rather than generating another
-- candidate for the same user.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_request_token(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.portal_token_requests;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.portal_has_access(p_user_id) THEN
    RETURN jsonb_build_object(
      'request_id', NULL,
      'status', 'already_access',
      'already_access', true
    );
  END IF;

  SELECT * INTO v_request
    FROM public.portal_token_requests
   WHERE user_id = p_user_id
     AND status IN ('pending','assigned')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_request.id IS NULL THEN
    INSERT INTO public.portal_token_requests(user_id, status)
    VALUES (p_user_id, 'pending')
    ON CONFLICT DO NOTHING;

    SELECT * INTO v_request
      FROM public.portal_token_requests
     WHERE user_id = p_user_id
       AND status IN ('pending','assigned')
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'created_at', v_request.created_at,
    'assigned_at', v_request.assigned_at,
    'assigned_token_id', v_request.assigned_token_id,
    'already_pending', v_request.status = 'pending' AND v_request.created_at < now() - interval '2 seconds',
    'already_assigned', v_request.status = 'assigned'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- TOKEN REDEMPTION: token lifetime controls redemption eligibility; grant
-- lifetime is always exactly 24h from successful redemption.
-- -------------------------------------------------------------------------
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

  -- Owner-generated portal tokens are reusable by every authenticated member.
  -- assigned_user_id/assigned_request_id are historical compatibility fields
  -- and are intentionally ignored by the global-token redemption contract.
  INSERT INTO public.portal_access_grants(
    user_id, token_id, granted_at, expires_at, last_verified_at
  )
  VALUES (p_user_id, v_token.id, v_now, v_grant_expires_at, v_now)
  ON CONFLICT (user_id) DO UPDATE SET
    token_id = EXCLUDED.token_id,
    granted_at = EXCLUDED.granted_at,
    expires_at = EXCLUDED.expires_at,
    last_verified_at = EXCLUDED.last_verified_at;

  -- Do not mutate token status/used_at. The same active token is intentionally
  -- reusable by many users until the token expires or the Owner revokes it.
  RETURN jsonb_build_object(
    'valid', true,
    'token_expires_at', v_token.expires_at,
    'grant_expires_at', v_grant_expires_at,
    'duration_mode', coalesce(v_token.duration_mode, 'legacy'),
    'reusable', true
  );
END;
$$;

-- -------------------------------------------------------------------------
-- OWNER REQUEST LIST: expose durable assignment metadata so the UI can pick
-- exactly one pending request and see which requests are already assigned.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_list_token_requests(
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
  v_pending bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.portal_token_requests;
  SELECT count(*) INTO v_pending
    FROM public.portal_token_requests
   WHERE status = 'pending';

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT
        r.id,
        r.user_id,
        u.email,
        r.status,
        r.created_at,
        r.assigned_at,
        r.assigned_by,
        r.assigned_token_id,
        r.resolved_at,
        r.resolved_by
        FROM public.portal_token_requests r
        JOIN auth.users u ON u.id = r.user_id
       ORDER BY r.created_at DESC
       LIMIT p_limit OFFSET p_offset
    ) x;

  RETURN jsonb_build_object(
    'requests', v_rows,
    'total', v_total,
    'pending', v_pending,
    'limit', p_limit,
    'offset', p_offset
  );
END;
$$;

-- -------------------------------------------------------------------------
-- OWNER TOKEN CREATION: explicit request-id contract.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, text, text, timestamptz, text, uuid);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(timestamptz, uuid, text, text);
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, text, text, timestamptz, text);

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
    token_hash,
    token_preview,
    token_encrypted,
    status,
    expires_at,
    created_by,
    assigned_user_id,
    assigned_request_id,
    duration_mode
  )
  VALUES (
    lower(trim(p_token_hash)),
    trim(p_token_preview),
    trim(p_token_encrypted),
    'active',
    p_expires_at,
    p_owner_user_id,
    NULL,
    NULL,
    NULLIF(v_mode, 'legacy')
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

-- The six-argument RPC is the sole Owner generation contract.
REVOKE ALL ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text) TO service_role;


REVOKE ALL ON FUNCTION public.portal_has_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_has_access(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.portal_request_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_request_token(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.portal_verify_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_verify_token(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.owner_list_token_requests(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_token_requests(uuid, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.portal_get_token_lifetime(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_token_lifetime(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
