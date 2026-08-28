# Current Repository Status — 2026-08-26

## Cleanup scope

This cleanup intentionally avoids changes to live data, Supabase schema, provider credentials, provider endpoint contracts, or authentication semantics. Changes are limited to source consistency, safe webhook correlation, documentation hygiene, and verification accuracy.

## Changes applied

1. Fixed the browser polling parameter typo in `public/js/home.js`.
2. Removed the duplicate versioned `public/js/home-20260826-2.js` source.
3. Pointed `public/html/home.html` at the single canonical `/js/home.js`.
4. Hardened the provider delivery webhook so a supplied `codeOrder` is used as the correlation key instead of falling back to another pending account for the same email.
5. Expanded `.env.example` to cover the actual runtime configuration surface, including the server-only provider token encryption secret.
6. Corrected `scripts/verify-runtime.mjs` route metrics so handler count, unique API path count, and all route path count are reported separately.
7. Replaced the active documentation index with a canonical source-of-truth guide and preserved historical reports under `docs/archive/`.

## Intentionally unchanged

- Supabase tables, columns, indexes, RPC names, and migration SQL.
- Provider paths and request/response contracts.
- Authentication and authorization model.
- Quota/idempotency semantics.
- Account data and user-facing page content.

## Known limitation requiring live deployment verification

The package can statically validate its repository contracts, but a ZIP snapshot cannot prove current reachability of the connected Supabase project or provider without the real deployment environment and secrets. Those checks should be run with the production configuration before deployment.
