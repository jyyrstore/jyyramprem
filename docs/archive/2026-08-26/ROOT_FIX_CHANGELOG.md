# ROOT FIX — Project Alight Motion v2

Date: 2026-08-24

## Fixed

1. Provider `/api/v1/verify-account` 4xx responses are now surfaced only as sanitized diagnostic metadata. Raw tokens, URLs, passwords, JWTs, and long secret-like values are redacted.
2. The portal still fails closed when `verify-account` does not explicitly return `verified: true`. No guessed fallback is used.
3. Mailbox magic-link delivery is now correlated to `am_generated_accounts.magic_link_requested_at`.
4. Inbox polling refuses to treat messages older than the fresh magic-link request as the delivered link. This prevents the old `auto-activate` message from consuming user quota.
5. A missing fresh-request timestamp blocks inbox delivery with `MAGIC_LINK_REQUEST_NOT_RECORDED`.
6. The existing per-account atomic magic-link quota remains idempotent: one generated account can consume at most one user delivery slot.

## Required migration order

1. `20260823210000_add_email_verification_state.sql`
2. `20260823223000_magic_link_delivery_quota.sql`
3. `20260824003000_add_magic_link_request_timestamp.sql`

Do not deploy the updated server before all three migrations exist in the production database.

## Still unresolved upstream

- The provider's `mailTmToken` is still rejected by `GET https://api.mail.tm/me` with HTTP 401 in live logs.
- The provider's `/api/v1/verify-account` currently returns HTTP 400 for the portal's configured `email` body mode. The portal now exposes only sanitized provider error metadata so the real upstream contract can be identified without logging secrets.
- The portal must not guess another request body mode until the provider contract is verified.

## 2026-08-26 — live verify-account shape alignment

- Fixed `extractProviderVerified()` to recognize the provider's live `profile.user.emailVerified` response shape.
- Added nested user/account/result variants for forward-compatible provider response parsing.
- Extended provider email extraction to recognize `profile.user.email` and equivalent nested shapes.
- Kept strict JWT validation before Premium activation; no token is returned to the browser.

## Release V4.2-fixed — 2026-08-26

Full source audit completed. Release includes the live verify-account response-shape fix and dedicated provider-verification contract tests.
