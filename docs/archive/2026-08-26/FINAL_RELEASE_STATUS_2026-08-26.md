# Final Release Status — 2026-08-26

## Canonical activation flow

`user email -> provider /api/v1/send-magiclink -> user's manually accessible email inbox -> user pastes fresh rawLink -> provider /api/v1/verify-account -> provider idToken -> provider /api/v1/apply-premium`

### Explicit boundary

- The portal does **not** connect to Mail.tm or any other mailbox API.
- The portal does **not** create, delete, authenticate, or manage mailboxes.
- Step 1 is acceptance-only: HTTP 200/provider acceptance does not mean the email was delivered.
- The fresh magic link is supplied manually by the user from an inbox they are authorized to access.
- `rawLink` is validated before provider verification.
- On a valid `rawLink`, the portal continues `verify-account -> apply-premium` automatically as one user action.
- Provider ID tokens remain server-side and are stored encrypted; they are not returned to the browser.
- No raw magic link is persisted in account state or generation logs.


## Hotfix 2026-08-26.2 — Home browser runtime
- Fixed `escapeHtml is not defined` on `home.html`; `home.js` now defines its own HTML escaping helper because `owner.js` is not loaded on Home.
- Fixed an undefined `accountId` reference after Step 1; polling now uses `window.__lastGeneratedAccountId`.
- Switched `home.html` to the versioned `/js/home-20260826-2.js` browser bundle so clients do not retain the broken cached script.
- Added regression coverage for both browser-runtime failures.
