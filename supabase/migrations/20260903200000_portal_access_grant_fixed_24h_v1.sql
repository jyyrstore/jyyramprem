-- Portal Access Grant Fixed 24h V2
--
-- Separate token lifetime from portal access lifetime:
--   15_days  -> token expires after 15 days
--   30_days  -> token expires after 30 days
--   permanent -> token never expires
--
-- Every successful token redemption creates a portal access grant that
-- expires exactly 24 hours after redemption. A token remains one-use only.
BEGIN;

-- Normalize already-existing grants to the new 24-hour access rule without
-- changing token expiry or token ownership/use state.
UPDATE public.portal_access_grants
SET expires_at = COALESCE(last_verified_at, granted_at, now()) + interval '24 hours'
WHERE expires_at IS DISTINCT FROM COALESCE(last_verified_at, granted_at, now()) + interval '24 hours';

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

  -- FOR UPDATE makes redemption atomic: the first successful request consumes
  -- the token, while any concurrent/second request sees it as already used.
  SELECT *
  INTO v_token
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

  INSERT INTO public.portal_access_grants(
    user_id,
    token_id,
    granted_at,
    expires_at,
    last_verified_at
  )
  VALUES (
    p_user_id,
    v_token.id,
    v_now,
    v_grant_expires_at,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    token_id = EXCLUDED.token_id,
    granted_at = EXCLUDED.granted_at,
    expires_at = EXCLUDED.expires_at,
    last_verified_at = EXCLUDED.last_verified_at;

  UPDATE public.portal_access_tokens
  SET used_at = v_now,
      status = 'used'
  WHERE id = v_token.id
    AND status = 'active'
    AND used_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or already used token';
  END IF;

  UPDATE public.portal_token_requests
  SET status = 'fulfilled',
      resolved_at = v_now,
      resolved_by = v_token.created_by
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

REVOKE ALL ON FUNCTION public.portal_verify_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_verify_token(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
