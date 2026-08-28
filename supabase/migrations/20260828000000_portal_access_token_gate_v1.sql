-- Portal Access Token Gate V1
-- Supabase-backed second gate after Auth. Token plaintext is never persisted.
-- The server generates the plaintext token and stores only SHA-256(token).

BEGIN;

CREATE TABLE IF NOT EXISTS public.portal_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.portal_access_grants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES public.portal_access_tokens(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.portal_token_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_token_requests_one_pending_per_user
  ON public.portal_token_requests(user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS portal_access_tokens_status_expiry_idx
  ON public.portal_access_tokens(status, expires_at DESC);
CREATE INDEX IF NOT EXISTS portal_access_grants_token_idx
  ON public.portal_access_grants(token_id);
CREATE INDEX IF NOT EXISTS portal_token_requests_status_created_idx
  ON public.portal_token_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_token_requests_user_created_idx
  ON public.portal_token_requests(user_id, created_at DESC);

ALTER TABLE public.portal_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_token_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.portal_access_tokens, public.portal_access_grants, public.portal_token_requests FROM PUBLIC, anon, authenticated;

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
    JOIN public.portal_access_tokens t ON t.id = g.token_id
    WHERE g.user_id = p_user_id
      AND t.status = 'active'
      AND t.expires_at > now()
      AND g.expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_request_token(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.portal_token_requests;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  INSERT INTO public.portal_token_requests(user_id, status)
  VALUES (p_user_id, 'pending')
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_request
  FROM public.portal_token_requests
  WHERE user_id = p_user_id AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'created_at', v_request.created_at,
    'already_pending', v_request.created_at < now() - interval '2 seconds'
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
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR length(trim(p_token_hash)) <> 64 THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  SELECT * INTO v_token
  FROM public.portal_access_tokens
  WHERE token_hash = lower(trim(p_token_hash))
  LIMIT 1;

  IF v_token.id IS NULL OR v_token.status <> 'active' OR v_token.expires_at <= v_now THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  INSERT INTO public.portal_access_grants(user_id, token_id, granted_at, expires_at, last_verified_at)
  VALUES (p_user_id, v_token.id, v_now, v_token.expires_at, v_now)
  ON CONFLICT (user_id) DO UPDATE SET
    token_id = EXCLUDED.token_id,
    granted_at = EXCLUDED.granted_at,
    expires_at = EXCLUDED.expires_at,
    last_verified_at = EXCLUDED.last_verified_at;

  UPDATE public.portal_token_requests
  SET status = 'fulfilled', resolved_at = v_now, resolved_by = v_token.created_by
  WHERE user_id = p_user_id AND status = 'pending';

  RETURN jsonb_build_object(
    'valid', true,
    'expires_at', v_token.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_token_requests(p_owner_user_id uuid, p_limit integer, p_offset integer)
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
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;

  SELECT count(*) INTO v_total FROM public.portal_token_requests;
  SELECT count(*) INTO v_pending FROM public.portal_token_requests WHERE status = 'pending';

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT r.id, r.user_id, u.email, r.status, r.created_at, r.resolved_at, r.resolved_by
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

CREATE OR REPLACE FUNCTION public.owner_create_portal_token(p_owner_user_id uuid, p_token_hash text, p_expires_at timestamptz)
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
  IF p_expires_at <= now() THEN RAISE EXCEPTION 'Token expiry must be in the future'; END IF;

  UPDATE public.portal_access_tokens
  SET status = 'revoked', revoked_at = now(), revoked_by = p_owner_user_id
  WHERE status = 'active';

  INSERT INTO public.portal_access_tokens(token_hash, status, expires_at, created_by)
  VALUES (lower(trim(p_token_hash)), 'active', p_expires_at, p_owner_user_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'expires_at', p_expires_at, 'status', 'active');
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_revoke_portal_token(p_owner_user_id uuid, p_token_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  UPDATE public.portal_access_tokens
  SET status = 'revoked', revoked_at = now(), revoked_by = p_owner_user_id
  WHERE id = p_token_id AND status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_portal_token_status(p_owner_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT jsonb_build_object(
    'id', id,
    'status', CASE WHEN status = 'active' AND expires_at > now() THEN 'active' ELSE 'expired' END,
    'expires_at', expires_at,
    'created_at', created_at
  ) INTO v
  FROM public.portal_access_tokens
  WHERE status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;
  RETURN coalesce(v, jsonb_build_object('status', 'none'));
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT proname, pg_get_function_identity_arguments(oid) args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND proname IN (
        'portal_has_access',
        'portal_request_token',
        'portal_verify_token',
        'owner_list_token_requests',
        'owner_create_portal_token',
        'owner_revoke_portal_token',
        'owner_get_portal_token_status'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
  END LOOP;
END;
$$;

COMMIT;
