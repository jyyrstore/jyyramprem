-- Canonical Jyy'R Amprem flow: verification is a durable gate before fresh magic-link requests.
ALTER TABLE public.am_generated_accounts
  ADD COLUMN IF NOT EXISTS email_verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

ALTER TABLE public.am_generated_accounts
  DROP CONSTRAINT IF EXISTS am_generated_accounts_email_verification_status_check;

ALTER TABLE public.am_generated_accounts
  ADD CONSTRAINT am_generated_accounts_email_verification_status_check
  CHECK (email_verification_status IN ('pending', 'verified'));

CREATE INDEX IF NOT EXISTS am_generated_accounts_email_verification_idx
  ON public.am_generated_accounts(user_id, email_verification_status, created_at DESC);
