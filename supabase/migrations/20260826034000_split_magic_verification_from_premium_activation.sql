-- JYY'R Amprem target flow:
-- send-magiclink -> user pastes fresh link -> verify-account -> user confirms -> apply-premium.
-- The provider ID token returned by verify-account is never sent to the browser.
-- It is stored only in encrypted form until apply-premium succeeds or the token expires.

ALTER TABLE public.am_generated_accounts
  ADD COLUMN IF NOT EXISTS provider_id_token_encrypted text,
  ADD COLUMN IF NOT EXISTS provider_token_expires_at timestamptz;

COMMENT ON COLUMN public.am_generated_accounts.provider_id_token_encrypted IS
  'Server-side AES-256-GCM encrypted provider ID token; never returned to clients or logs.';

COMMENT ON COLUMN public.am_generated_accounts.provider_token_expires_at IS
  'Expiration timestamp copied from the provider ID token; used to reject stale activation sessions.';

CREATE INDEX IF NOT EXISTS am_generated_accounts_provider_token_expiry_idx
  ON public.am_generated_accounts(provider_token_expires_at)
  WHERE provider_id_token_encrypted IS NOT NULL;
