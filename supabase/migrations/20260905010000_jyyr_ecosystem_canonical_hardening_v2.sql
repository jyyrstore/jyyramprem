-- JYY'R ECOSYSTEM hardening V2
-- Applies the Token Center publication state to the canonical redemption RPC.
BEGIN;

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
    SELECT 1 FROM public.member_profiles m
    WHERE m.user_id = p_user_id
      AND m.status IN ('suspended','banned')
  ) THEN
    RAISE EXCEPTION 'Member access restricted';
  END IF;

  SELECT * INTO v_token
  FROM public.portal_access_tokens
  WHERE token_hash = lower(trim(p_token_hash))
  LIMIT 1
  FOR UPDATE;

  IF v_token.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  -- A credential is redeemable only after Owner has explicitly published it.
  -- Publishing is intentionally separate from generation/inventory.
  IF v_token.published_at IS NULL THEN
    RAISE EXCEPTION 'Token is not available';
  END IF;

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

  -- Row lock + conditional update = atomic one-token/one-user claim.
  UPDATE public.portal_access_tokens
  SET assigned_user_id = p_user_id,
      used_at = v_now,
      status = 'used'
  WHERE id = v_token.id
    AND status = 'active'
    AND assigned_user_id IS NULL
    AND used_at IS NULL
    AND published_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token already used, revoked, or expired';
  END IF;

  INSERT INTO public.portal_access_grants(
    user_id, token_id, granted_at, access_expires_at, expires_at, last_verified_at
  )
  VALUES (
    p_user_id, v_token.id, v_now, v_access_expires_at, v_access_expires_at, v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    token_id = EXCLUDED.token_id,
    granted_at = EXCLUDED.granted_at,
    access_expires_at = EXCLUDED.access_expires_at,
    expires_at = EXCLUDED.expires_at,
    last_verified_at = EXCLUDED.last_verified_at;

  UPDATE public.portal_token_requests
  SET status = 'fulfilled', resolved_at = v_now, resolved_by = v_token.created_by
  WHERE user_id = p_user_id AND status = 'pending';

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
IS 'Canonical redemption: only published tokens can be redeemed; one token can be assigned to exactly one authenticated user atomically; access is 15d/30d/permanent.';

REVOKE ALL ON FUNCTION public.portal_verify_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_verify_token(uuid, text) TO service_role;

COMMIT;
