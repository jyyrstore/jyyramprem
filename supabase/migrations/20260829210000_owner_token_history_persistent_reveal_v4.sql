-- OWNER TOKEN HISTORY — persistent encrypted token reveal repair.
-- This migration is intentionally self-contained so it can be applied even
-- when the earlier secure-reveal migration was skipped or not propagated.
BEGIN;

ALTER TABLE public.portal_access_tokens
  ADD COLUMN IF NOT EXISTS token_encrypted text;

COMMENT ON COLUMN public.portal_access_tokens.token_encrypted IS
  'Owner-only encrypted portal token. Never plaintext; decrypted only server-side for Owner token history.';

-- Atomically persist the encrypted token at creation time.
CREATE OR REPLACE FUNCTION public.owner_create_portal_token(
  p_owner_user_id uuid,
  p_token_hash text,
  p_token_preview text,
  p_token_encrypted text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
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
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'Token expiry must be in the future';
  END IF;

  INSERT INTO public.portal_access_tokens
    (token_hash, token_preview, token_encrypted, status, expires_at, created_by)
  VALUES
    (lower(trim(p_token_hash)), trim(p_token_preview), trim(p_token_encrypted),
     'active', p_expires_at, p_owner_user_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'expires_at', p_expires_at,
    'status', 'active'
  );
END;
$$;

-- Keep the legacy 4-argument RPC available for older callers.
CREATE OR REPLACE FUNCTION public.owner_create_portal_token(
  p_expires_at timestamptz,
  p_owner_user_id uuid,
  p_token_hash text,
  p_token_preview text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
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
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'Token expiry must be in the future';
  END IF;

  INSERT INTO public.portal_access_tokens
    (token_hash, token_preview, status, expires_at, created_by)
  VALUES
    (lower(trim(p_token_hash)), trim(p_token_preview), 'active', p_expires_at, p_owner_user_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'expires_at', p_expires_at,
    'status', 'active'
  );
END;
$$;

-- Return the encrypted field to the trusted server so it can decrypt for the
-- Owner. The plaintext token is never returned by PostgreSQL.
CREATE OR REPLACE FUNCTION public.owner_list_portal_tokens(
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
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Invalid limit';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid offset';
  END IF;

  SELECT count(*) INTO v_total FROM public.portal_access_tokens;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      t.id,
      t.token_preview AS preview,
      t.token_encrypted,
      CASE
        WHEN t.status = 'active' AND t.expires_at <= now() THEN 'expired'
        ELSE t.status
      END AS status,
      t.created_at,
      t.expires_at,
      t.used_at,
      t.revoked_at,
      u.email AS used_email
    FROM public.portal_access_tokens t
    LEFT JOIN public.portal_access_grants g ON g.token_id = t.id
    LEFT JOIN auth.users u ON u.id = g.user_id
    ORDER BY t.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) x;

  RETURN jsonb_build_object(
    'tokens', v_rows,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
  );
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT proname, pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND proname IN ('owner_create_portal_token', 'owner_list_portal_tokens')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname, r.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      r.proname, r.args
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
