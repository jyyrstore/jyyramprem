BEGIN;

CREATE TABLE IF NOT EXISTS public.am_email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.am_email_verifications
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS am_email_verifications_user_id_idx
  ON public.am_email_verifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS am_email_verifications_expires_idx
  ON public.am_email_verifications(expires_at);

CREATE INDEX IF NOT EXISTS am_email_verifications_user_active_idx
  ON public.am_email_verifications(user_id, created_at DESC)
  WHERE used_at IS NULL;

ALTER TABLE public.am_email_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.am_email_verifications FROM PUBLIC, anon, authenticated;

COMMIT;
