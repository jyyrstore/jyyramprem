-- Atomic server-side claim for Premium activation.
-- Prevents concurrent requests from applying the same verified account twice.
ALTER TABLE public.am_generated_accounts
  ADD COLUMN IF NOT EXISTS premium_activation_claim_token text,
  ADD COLUMN IF NOT EXISTS premium_activation_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS am_generated_accounts_activation_claim_idx
  ON public.am_generated_accounts(premium_activation_claimed_at)
  WHERE premium_activation_claim_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_premium_activation(
  p_user_id uuid,
  p_account_id uuid,
  p_claim_token text,
  p_stale_after_seconds integer DEFAULT 120
)
RETURNS TABLE (claimed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_account_id IS NULL OR p_claim_token IS NULL OR char_length(trim(p_claim_token)) < 32 THEN
    RETURN QUERY SELECT false, 'invalid_claim'::text;
    RETURN;
  END IF;

  SELECT premium_activation_claimed_at
    INTO v_claimed_at
  FROM public.am_generated_accounts
  WHERE id = p_account_id
    AND user_id = p_user_id
    AND status <> 'success'
    AND email_verification_status = 'verified'
    AND provider_id_token_encrypted IS NOT NULL
    AND provider_token_expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid_state'::text;
    RETURN;
  END IF;

  IF v_claimed_at IS NOT NULL
     AND v_claimed_at > now() - make_interval(secs => GREATEST(30, LEAST(p_stale_after_seconds, 900))) THEN
    RETURN QUERY SELECT false, 'already_claimed'::text;
    RETURN;
  END IF;

  UPDATE public.am_generated_accounts
  SET premium_activation_claim_token = p_claim_token,
      premium_activation_claimed_at = now(),
      updated_at = now()
  WHERE id = p_account_id AND user_id = p_user_id;

  RETURN QUERY SELECT true, 'claimed'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_premium_activation_claim(
  p_user_id uuid,
  p_account_id uuid,
  p_claim_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.am_generated_accounts
  SET premium_activation_claim_token = NULL,
      premium_activation_claimed_at = NULL,
      updated_at = now()
  WHERE id = p_account_id
    AND user_id = p_user_id
    AND premium_activation_claim_token = p_claim_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_premium_activation(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_premium_activation_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_premium_activation(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_premium_activation_claim(uuid, uuid, text) TO service_role;
