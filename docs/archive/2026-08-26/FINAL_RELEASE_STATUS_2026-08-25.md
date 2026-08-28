# AMPREM 4.2.0 FINAL RELEASE STATUS — 2026-08-25

## Canonical flow

`send-magiclink -> verify-account(rawLink) -> apply-premium(idToken)`

## Local verification

- `node --check server.js` — PASS
- `node --check public/js/home.js` — PASS
- `npm test` — PASS
- automated subtests — 33 passed, 0 failed
- runtime verification — PASS
- API route count — 45
- RPC references — 40

## Live provider proof supplied during finalization

- `send-magiclink` — success
- `verify-account` — success, `emailVerified=true`, ID token returned
- `apply-premium` — success, premium result `status=success`, `valid=true`

## Important boundary

The live provider proof was executed externally in Termux by the project owner and is recorded here as supplied evidence; this package does not contain provider credentials or live tokens.

## Secrets

`.env`, provider API keys, Supabase service-role secrets, and live tokens are excluded from the release archive.
