# Root Audit — AMPREM V4.2 — 2026-08-26

## 1. Root-cause of the reported startup error

The reported stack trace terminates at:

`server.js -> createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`

The previous configuration helper only checked that `SUPABASE_URL` was non-empty. It did not validate the value as an HTTP/HTTPS URL before passing it to `@supabase/supabase-js`.

The corrected build now:

- validates `SUPABASE_URL` with the standard `URL` parser;
- requires `http:` or `https:`;
- rejects empty, `undefined`, `null`, and known placeholder values;
- accepts a bare hostname such as `jfjbdenqepaagxfysaar.supabase.co` and normalizes it to HTTPS;
- strips a trailing slash;
- applies the same HTTP/HTTPS validation to `PROVIDER_BASE_URL`.

Supabase's current JavaScript documentation requires a unique Supabase URL as the first `createClient()` argument and shows an HTTPS project URL in the canonical form. This matches the corrected runtime validation.

## 2. Runtime/source structure inspected

The package contains:

- `server.js`
- 9 browser JavaScript files
- 7 HTML pages
- 7 CSS files
- 3 shared backend contract libraries
- 2 runtime scripts
- 6 test modules
- 1 regression script
- 16 SQL migration files
- package metadata and lockfile
- project documentation and release/audit records
- static assets

`node_modules/` is excluded from the release archive when repackaged.

## 3. Backend -> frontend wiring

The server exposes 45 Express routes in the source snapshot.

The frontend consumes the API through the `/api/*` endpoints, including:

- `/api/config`
- authentication/session-backed account APIs
- `/api/generate`
- account email verification
- premium activation
- usage/quota
- Owner status/claim APIs

`/api/config` returns only the Supabase URL and publishable key. The service-role key remains server-only.

## 4. Backend -> Supabase wiring

The server references 40 PostgreSQL RPC names.

The connected production Supabase project currently contains all 40 referenced RPCs, including:

- Owner authorization and management functions
- member messaging/notification functions
- generation idempotency
- provider quota
- magic-link quota
- maintenance
- public/member helper functions

The runtime tables used directly by the backend also exist in production, including:

- `am_generated_accounts`
- `am_generation_logs`
- `am_api_usage`
- `am_magic_link_quota_usage`

The Owner/Member tables and supporting tables exist as well.

RLS is enabled on all inspected runtime application tables.

Privileged application RPCs queried during this audit are executable by `service_role` and not by `anon` or `authenticated`.

## 5. Production database status

The connected database is PostgreSQL 17.6.

The production migration history is ahead of and materially different from the 16 migration files included in this ZIP. Production contains additional historical migrations and several fixes that are not represented byte-for-byte in the repository snapshot.

This is a **migration-history synchronization gap**, not a current runtime schema failure.

The important distinction is:

- production schema/function contract: currently present and compatible with the inspected server;
- local migration history: incomplete relative to production history;
- historical migration bodies cannot be honestly reconstructed from migration version names alone.

The package therefore must not claim that the local SQL directory is a byte-for-byte copy of production migration history.

## 6. Target user flow

The current code implements the intended flow:

`user email -> send magic link -> user pastes fresh link -> verify-account -> apply-premium`

The provider ID token is stored encrypted server-side and is not returned to browser JavaScript.

## 7. Verification performed after the fix

Local verification:

- `node --check server.js` — PASS
- `node scripts/verify-runtime.mjs` — PASS
- `npm test` — PASS
- 33 tests passed, 0 failed
- API route count — 45
- RPC reference count — 40
- frontend local asset references — PASS

Runtime smoke tests:

- bare Supabase hostname automatically normalized to `https://...` — PASS
- `/api/config` returned the normalized URL — PASS
- malformed `SUPABASE_URL` now fails fast with a configuration-specific error instead of reaching `createClient()` — PASS

## 8. Deployment requirement that cannot be bundled

The ZIP intentionally does not contain:

- Supabase service-role/secret keys
- provider API key
- provider token-encryption secret
- a live `.env`

Therefore the final deployment still requires a real `.env` or hosting environment configuration.

Recommended starting point:

1. Copy `.env.example` to `.env`.
2. Keep the verified Supabase URL.
3. Replace every `REPLACE_WITH_*` / `CHANGE_ME_*` value with the real secret.
4. Run `npm ci`.
5. Run `npm test`.
6. Run `npm start`.

