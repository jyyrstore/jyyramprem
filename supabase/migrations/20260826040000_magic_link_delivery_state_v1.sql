-- Explicitly separate provider acceptance from actual email delivery.
-- The portal must never infer delivery from HTTP 200 alone.

ALTER TABLE public.am_generated_accounts
  ADD COLUMN IF NOT EXISTS magic_link_delivery_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS magic_link_code_order text,
  ADD COLUMN IF NOT EXISTS magic_link_delivery_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS magic_link_last_error text;

ALTER TABLE public.am_generated_accounts
  DROP CONSTRAINT IF EXISTS am_generated_accounts_magic_link_delivery_status_check;

ALTER TABLE public.am_generated_accounts
  ADD CONSTRAINT am_generated_accounts_magic_link_delivery_status_check
  CHECK (magic_link_delivery_status IN (
    'not_requested',
    'provider_accepted',
    'delivery_confirmed',
    'delivery_failed'
  ));

CREATE INDEX IF NOT EXISTS am_generated_accounts_magic_link_delivery_status_idx
  ON public.am_generated_accounts(user_id, magic_link_delivery_status, magic_link_requested_at DESC);

COMMENT ON COLUMN public.am_generated_accounts.magic_link_delivery_status IS
  'Provider acceptance and email delivery are distinct states. HTTP 200 never implies delivery_confirmed.';
COMMENT ON COLUMN public.am_generated_accounts.magic_link_code_order IS
  'Opaque provider order/reference used for delivery correlation; never treated as a magic link token.';
