BEGIN;

ALTER TABLE public.portal_access_tokens
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS used_at timestamptz;

CREATE INDEX IF NOT EXISTS portal_access_tokens_assigned_user_idx
  ON public.portal_access_tokens(assigned_user_id, created_at DESC);

-- Invalidate any pre-existing global active token so all newly issued tokens
-- are tied to exactly one pending user request.
UPDATE public.portal_access_tokens
SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
WHERE status = 'active';

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

  IF v_token.id IS NULL
     OR v_token.status <> 'active'
     OR v_token.used_at IS NOT NULL
     OR v_token.expires_at <= v_now
     OR v_token.assigned_user_id IS NULL
     OR v_token.assigned_user_id <> p_user_id THEN
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
  SET used_at = v_now, status = 'revoked', revoked_at = v_now, revoked_by = v_token.created_by
  WHERE id = v_token.id AND status = 'active';

  UPDATE public.portal_token_requests
  SET status = 'fulfilled', resolved_at = v_now, resolved_by = v_token.created_by
  WHERE user_id = p_user_id AND status = 'pending';

  RETURN jsonb_build_object('valid', true, 'expires_at', v_token.expires_at);
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
  v_user_id uuid;
  v_request_id uuid;
  v_email text;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_token_hash IS NULL OR length(trim(p_token_hash)) <> 64 THEN RAISE EXCEPTION 'Invalid token hash'; END IF;
  IF p_expires_at <= now() THEN RAISE EXCEPTION 'Token expiry must be in the future'; END IF;

  SELECT r.id, r.user_id, u.email
  INTO v_request_id, v_user_id, v_email
  FROM public.portal_token_requests r
  JOIN auth.users u ON u.id = r.user_id
  WHERE r.status = 'pending'
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No pending token request'; END IF;

  UPDATE public.portal_access_tokens
  SET status = 'revoked', revoked_at = now(), revoked_by = p_owner_user_id
  WHERE status = 'active';

  INSERT INTO public.portal_access_tokens(token_hash, status, expires_at, created_by, assigned_user_id)
  VALUES (lower(trim(p_token_hash)), 'active', p_expires_at, p_owner_user_id, v_user_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'expires_at', p_expires_at,
    'status', 'active',
    'assigned_user_id', v_user_id,
    'assigned_email', v_email,
    'request_id', v_request_id
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
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT jsonb_build_object(
    'id', t.id,
    'status', CASE WHEN t.status = 'active' AND t.expires_at > now() AND t.used_at IS NULL THEN 'active' ELSE 'expired' END,
    'expires_at', t.expires_at,
    'created_at', t.created_at,
    'assigned_user_id', t.assigned_user_id,
    'assigned_email', u.email
  ) INTO v
  FROM public.portal_access_tokens t
  LEFT JOIN auth.users u ON u.id = t.assigned_user_id
  WHERE t.status = 'active'
  ORDER BY t.created_at DESC
  LIMIT 1;
  RETURN coalesce(v, jsonb_build_object('status', 'none'));
END;
$$;

COMMIT;
