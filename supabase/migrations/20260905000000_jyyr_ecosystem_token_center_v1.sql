-- JYY'R ECOSYSTEM: Token Center + publish quota + username privacy + auth handoff
-- Source of truth: update.md
--
-- Guarantees:
--   * Generate is inventory only and has no daily quota.
--   * Publish/distribution is a separate operation, max 5 successful operations
--     per UTC calendar day.
--   * A published token is public; token value may be shown in full.
--   * Public data never exposes claimant email.
--   * Claim/verification remains canonical in portal_verify_token().
--   * One token can be redeemed by exactly one authenticated user (existing V7 contract).
--   * Cross-site handoff uses a short-lived opaque state, never a session/JWT/password.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Username: canonical public identifier, distinct from email.
-- ---------------------------------------------------------------------------
ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS member_profiles_username_ci_unique_idx
  ON public.member_profiles (lower(username))
  WHERE username IS NOT NULL AND btrim(username) <> '';

-- Backfill only usernames that are unambiguous in Auth metadata.
WITH candidates AS (
  SELECT
    u.id AS user_id,
    btrim(u.raw_user_meta_data ->> 'username') AS username
  FROM auth.users u
  WHERE btrim(COALESCE(u.raw_user_meta_data ->> 'username', '')) <> ''
), unique_candidates AS (
  SELECT lower(username) AS username_ci, min(user_id::text)::uuid AS user_id, min(username) AS username
  FROM candidates
  GROUP BY lower(username)
  HAVING count(*) = 1
)
UPDATE public.member_profiles p
SET username = uc.username,
    updated_at = now()
FROM unique_candidates uc
WHERE p.user_id = uc.user_id
  AND (p.username IS NULL OR btrim(p.username) = '');

-- ---------------------------------------------------------------------------
-- 2. Public publication state and immutable publication audit.
-- ---------------------------------------------------------------------------
ALTER TABLE public.portal_access_tokens
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS portal_access_tokens_publication_state_idx
  ON public.portal_access_tokens(published_at DESC, status, redemption_expires_at);

CREATE TABLE IF NOT EXISTS public.portal_token_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES public.portal_access_tokens(id) ON DELETE CASCADE,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  distribution_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_token_publications_token_idx
  ON public.portal_token_publications(token_id, published_at DESC);
CREATE INDEX IF NOT EXISTS portal_token_publications_day_idx
  ON public.portal_token_publications(distribution_date, published_at DESC);

ALTER TABLE public.portal_token_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_token_publications FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Atomic daily publication quota.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_daily_distribution_quota (
  calendar_date date PRIMARY KEY,
  publish_count integer NOT NULL DEFAULT 0 CHECK (publish_count >= 0 AND publish_count <= 5),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portal_daily_distribution_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_daily_distribution_quota FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Short-lived opaque cross-site auth handoff.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jyyr_ecosystem_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS jyyr_ecosystem_handoffs_expiry_idx
  ON public.jyyr_ecosystem_handoffs(expires_at);

ALTER TABLE public.jyyr_ecosystem_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jyyr_ecosystem_handoffs FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Canonical Owner publish: atomic 5/day calendar quota.
--     Calendar day is UTC, matching the existing backend todayUTC contract.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_publish_portal_token(
  p_owner_user_id uuid,
  p_token_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token public.portal_access_tokens;
  v_today date := timezone('UTC', now())::date;
  v_count integer;
  v_published_at timestamptz := now();
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF p_token_id IS NULL THEN
    RAISE EXCEPTION 'Token ID is required';
  END IF;

  SELECT * INTO v_token
  FROM public.portal_access_tokens
  WHERE id = p_token_id
  FOR UPDATE;

  IF v_token.id IS NULL THEN
    RAISE EXCEPTION 'Token not found';
  END IF;

  IF v_token.published_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_published', true,
      'published_at', v_token.published_at,
      'distribution_date', (SELECT max(p.distribution_date) FROM public.portal_token_publications p WHERE p.token_id = v_token.id)
    );
  END IF;

  IF v_token.status <> 'active'
     OR v_token.used_at IS NOT NULL
     OR v_token.redemption_expires_at <= now() THEN
    RAISE EXCEPTION 'Token is not publishable';
  END IF;

  -- Serialize the quota row. Concurrent publishers for the same calendar day
  -- cannot push the successful count above five.
  INSERT INTO public.portal_daily_distribution_quota(calendar_date, publish_count, updated_at)
  VALUES (v_today, 0, now())
  ON CONFLICT (calendar_date) DO NOTHING;

  SELECT publish_count INTO v_count
  FROM public.portal_daily_distribution_quota
  WHERE calendar_date = v_today
  FOR UPDATE;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'Daily publish quota exhausted';
  END IF;

  UPDATE public.portal_access_tokens
  SET published_at = v_published_at,
      published_by = p_owner_user_id
  WHERE id = v_token.id
    AND published_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token was published concurrently';
  END IF;

  UPDATE public.portal_daily_distribution_quota
  SET publish_count = publish_count + 1,
      updated_at = now()
  WHERE calendar_date = v_today;

  INSERT INTO public.portal_token_publications(
    token_id, published_at, published_by, distribution_date
  )
  VALUES (
    v_token.id, v_published_at, p_owner_user_id, v_today
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_published', false,
    'published_at', v_published_at,
    'distribution_date', v_today,
    'publish_count', v_count + 1,
    'remaining', 5 - (v_count + 1)
  );
END;
$$;

-- Separate unpublish is management, not a publish success and therefore does
-- not decrement the historical daily quota counter.
CREATE OR REPLACE FUNCTION public.owner_unpublish_portal_token(
  p_owner_user_id uuid,
  p_token_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  UPDATE public.portal_access_tokens
  SET published_at = NULL,
      published_by = NULL
  WHERE id = p_token_id
    AND published_at IS NOT NULL
    AND status = 'active'
    AND assigned_user_id IS NULL
    AND used_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cleanup and grants.
-- ---------------------------------------------------------------------------
-- All mutations remain server-only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.owner_publish_portal_token(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_publish_portal_token(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.owner_unpublish_portal_token(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_unpublish_portal_token(uuid, uuid) TO service_role;

COMMIT;
