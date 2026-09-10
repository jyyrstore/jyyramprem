# Canonical Supabase migration order

The migration directory contains historical migrations from iterative portal-token designs. They are intentionally retained for migration-history compatibility and must not be reordered, deleted, or rewritten after being applied to a live project.

## Final portal-token contract

`20260910040000_direct_redeem_owner_tokens_v1.sql` is the latest source-package corrective migration for the portal-token system. It supersedes only the publication-gate portion of the V2 ecosystem hardening while preserving the V7 single-user binding and two-clock lifetime contract.

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

Live production state was re-verified during the 2026-09-09 audit. The Supabase migration ledger contains 79 recorded migrations and currently reaches version `20260904122452` (`remove_duplicate_app_release_timestamp_trigger`). The supplied source package keeps the semantically equivalent V7 portal-token migration under `20260904150000`; do not rename or rewrite already-applied production migration history. The application/server contract uses the canonical `portal_verify_token(uuid,text)` signature and the `redemption_expires_at` / `access_expires_at` fields; older V6-era code that treats token `expires_at` as the member-access lifetime is incompatible. The source package contains ecosystem Token Center migrations plus the latest direct-redemption correction. Live production was verified separately: the required Token Center tables and the direct-redeem `portal_verify_token()` definition are present, but the migration ledger does not contain those later source timestamps. Do not replay these files blindly; reconcile migration history with the live schema before any deployment tooling attempts to push them.
