# Jyy'R Amprem — Alight Motion Account Portal V4.2

This directory contains the active technical documentation plus preserved historical audit/release reports. The application runtime remains Express + Supabase, with the provider contract isolated under `lib/`.

## Current source of truth

The authoritative runtime files are:

- `server.js` — HTTP routes and server orchestration
- `lib/*.js` — provider/magic-link contracts
- `public/html/*.html` — page structure
- `public/js/*.js` — browser behavior
- `public/css/*.css` — UI styles
- `supabase/migrations/*.sql` — repository migration set
- `scripts/verify-runtime.mjs` — static/runtime-contract verification
- `test/` and `tests/` — automated regression contracts

Historical audit reports are preserved under `docs/archive/` and are not treated as current source-of-truth metrics.

## Start

```bash
npm ci
cp .env.example .env
# Fill every required secret/value in .env
npm start
```

Pages:

- `https://www.jyyramprem.my.id/`
- `https://www.jyyramprem.my.id/login.html`
- `https://www.jyyramprem.my.id/home.html`
- `https://www.jyyramprem.my.id/dashboard.html`
- `https://www.jyyramprem.my.id/setting.html`
- `https://www.jyyramprem.my.id/owner.html`

## Environment

Required for the web server:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROVIDER_BASE_URL`
- `PROVIDER_API_KEY`
- `PROVIDER_TOKEN_ENCRYPTION_KEY` for verification/apply-premium flows (minimum 32 characters)

The complete configuration surface, including optional limits, provider paths, diagnostics, and the broadcast worker variables, is documented in the repository `.env.example`.

## Verification

```bash
npm run verify
npm test
```

The full suite validates provider contracts, diagnostic normalization, magic-link flow contracts, quota/idempotency contracts, frontend auto-chain expectations, local references, dependency lock synchronization, and route/RPC inventory consistency.

## Target flow

`User email -> send-magiclink -> user retrieves the fresh link -> verify-account -> encrypted idToken -> apply-premium -> Premium ON`.

The portal does not create or authenticate a separate mailbox. The browser uses the configured Supabase publishable key; service-role credentials, provider API credentials, and encrypted provider tokens remain server-side.

## Portal token access

The canonical portal access contract is `1 TOKEN = 1 USER`: a newly generated token is unassigned and redeemable by any member for 24 hours. The first successful redemption locks the token to that user. Access then lasts 15 days, 30 days, or permanently according to the token mode. Logout preserves active access; expired access is denied by the backend and the protected-page watchdog redirects the member to the token gate. See `PORTAL_TOKEN_LIFETIME_ACCESS_CONTRACT.md`.

## Migration note

`supabase/migrations/` is the canonical migration set included in this package. The repository preserves the migration files available in this snapshot; historical production migration history must not be inferred from older audit reports.
