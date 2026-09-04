# Canonical Supabase migration order

The migration directory contains historical migrations from iterative portal-token designs. They are intentionally retained for migration-history compatibility and must not be reordered, deleted, or rewritten after being applied to a live project.

## Final portal-token contract

`20260904150000_canonical_single_user_token_redemption_v7.sql` is the source-package final corrective migration for the portal-token system and supersedes the earlier V4/V5/V6 portal-token semantics.

The final contract is:

- 1 token = 1 user after the first successful redemption.
- Every new token has a 24-hour redemption window.
- An unused token expires after 24 hours and remains in history.
- `15_days` grants access for 15 days from redemption.
- `30_days` grants access for 30 days from redemption.
- `permanent` grants access with no expiry (`NULL`).
- Redemption expiry does not end an already redeemed user's access.
- Owner does not need a portal token.
- Revoking a token denies access immediately while preserving history.

## Production note

Live production was re-verified on 2026-09-04. The Supabase migration ledger currently reaches version `20260904083839`, whose recorded name corresponds to the live application of the V7 semantic contract. The supplied source package contains the semantically equivalent V7 file under `20260904150000`; do not rename already-applied migration history. The application/server contract uses the V7 canonical RPC signature and redemption/access fields; V6-era code that computes a 15/30-day token `expires_at` is incompatible with this final contract.
