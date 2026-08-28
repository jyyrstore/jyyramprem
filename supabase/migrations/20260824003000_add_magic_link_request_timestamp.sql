-- Fresh magic-link mailbox correlation.
-- Prevents an older auto-activate message from being treated as the fresh delivery.
ALTER TABLE public.am_generated_accounts
  ADD COLUMN IF NOT EXISTS magic_link_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS am_generated_accounts_magic_link_requested_idx
  ON public.am_generated_accounts(user_id, magic_link_requested_at DESC);
