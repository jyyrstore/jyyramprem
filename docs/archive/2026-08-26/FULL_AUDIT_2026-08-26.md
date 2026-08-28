# FULL AUDIT — Project Alight Motion V4.2

Date: 2026-08-26
Scope: full source/config/frontend/backend/Supabase migration/test audit plus live read-only Supabase verification.

## Executive result

The project is internally wired for the intended three-stage architecture:

`user email -> provider /api/v1/send-magiclink -> fresh mailbox link -> provider /api/v1/verify-account -> provider ID token stored encrypted -> provider /api/v1/apply-premium`

The concrete live-contract bug found in the ZIP was the provider verification flag location. The observed live response puts the flag at `profile.user.emailVerified`, while the previous extractor only checked `profile.emailVerified`. That could turn a successful provider response into `VERIFICATION_STATUS_MISSING` and block Step 2.

### Fixed in this release

- Provider verification parsing now accepts `profile.user.emailVerified` and equivalent nested user/account/result variants.
- Provider email extraction now accepts nested `profile.user.email` / user variants.
- Provider verification parsing was moved to a dedicated pure contract module: `lib/provider-verification-contract.js`.
- Added unit coverage using the live response shape shown in the runtime diagnostic.
- Existing strict JWT validation remains in force: email must match, `email_verified` must be true, and `exp` must be in the future.
- Provider ID token remains server-only and encrypted at rest; it is not returned to browser code.

## Step-by-step contract mapping

### Step 1 — send magic link

Provider request:

`POST https://alightfree.my.id/api/v1/send-magiclink`

Body:

`{"email":"<user-email>"}`

Headers:

`Content-Type: application/json`

`x-api-key: <server-side secret>`

Observed live response semantics:

- HTTP 200
- `success: true`
- `codeOrder` present
- `data.success: true`
- `data.message: "Link berhasil dikirim."`
- delivery channel: `email_mailbox`
- delivery is provider-accepted, not delivery-confirmed
- magic link is not necessarily present in the provider response

The project models this correctly. It intentionally does not claim inbox delivery from HTTP 200 alone.

### Step 2 — verify magic link

Portal route:

`POST /api/accounts/:id/verify-email`

Provider request:

`POST /api/v1/verify-account`

Body:

`{"email":"<user-email>","rawLink":"<fresh-provider-link>"}`

The accepted magic-link hosts/path are restricted to:

- `https://alightcreative.com/auth_action...`
- `https://alight-creative.firebaseapp.com/__/auth/links...`

The observed provider response shape is compatible with:

- `success: true`
- `email`
- `profile.idToken`
- `profile.user.emailVerified: true`
- `profile.user.email`

The previous implementation missed `profile.user.emailVerified`; this release fixes that mismatch.

The portal then performs independent JWT checks before storing the token:

1. token parses as a JWT
2. token email matches account email
3. `claims.email_verified === true`
4. `claims.exp` exists and is still valid

The token is encrypted with AES-256-GCM and stored server-side only until Step 3 or expiry.

### Step 3 — apply premium

Portal route:

`POST /api/accounts/:id/apply-premium`

Provider request:

`POST /api/v1/apply-premium`

Body:

`{"email":"<user-email>","idToken":"<server-side-token>"}`

The project accepts the provider result when:

- HTTP response is OK
- top-level `success === true`
- premium result status is `success`
- premium result `valid === true`

It also rejects an unexpected provider email and clears the encrypted token after successful activation or invalid/expired verification state.

## Frontend/backend wiring

Frontend uses portal endpoints rather than exposing the provider key directly:

- `/api/generate` -> provider Step 1
- `/api/accounts/:id/send-magiclink` -> provider Step 1 resend
- `/api/accounts/:id/magiclink-status` -> delivery state
- `/api/accounts/:id/verify-email` -> provider Step 2
- `/api/accounts/:id/apply-premium` -> provider Step 3

The browser never receives the provider API key or server-side ID token.

## Quota/idempotency

The design separates:

- provider API request quota
- user magic-link quota
- generation idempotency

User magic-link quota is recorded only after successful Premium activation. Repeated activation on the same account is guarded by state and encrypted-token presence.

Provider quota is reserved per endpoint and recorded as success/failure through dedicated RPCs.

## Supabase live verification

Read-only queries against project `jfjbdenqepaagxfysaar` confirmed:

- `public.am_generated_accounts` contains:
  - `email_verification_status`
  - `email_verified_at`
  - `magic_link_requested_at`
  - `provider_id_token_encrypted`
  - `provider_token_expires_at`
  - `magic_link_delivery_status`
  - `magic_link_code_order`
  - `magic_link_delivery_confirmed_at`
  - `magic_link_last_error`
- referenced server RPCs exist, including generation idempotency and magic-link quota functions
- sensitive RPCs checked (`claim_generation_request`, `consume_magic_link_quota`, `finalize_generation_request`, `record_provider_api_result`, `reserve_provider_api_request`) are not executable by `anon` or `authenticated` and are executable by `service_role`
- checked SECURITY DEFINER functions have explicit `search_path=public, pg_temp`

## Migration-history synchronization gap

The repository contains a curated subset of migrations, while the live Supabase migration-history table contains additional historical versions not present in the ZIP. Conversely, the ZIP contains recent local migration filenames whose exact version entries are not present in the live migration-history table even though the corresponding columns already exist live.

This means the database schema is currently compatible with the inspected runtime contract, but the local migration directory is **not** a byte-for-byte reconstruction of the production migration history.

No historical migration body was invented or reconstructed from version numbers alone.

## Static audit

- Node requirement: `>=22`
- dependency lock: synchronized
- API routes reported by runtime verifier: 48
- Supabase RPC references in `server.js`: 40
- HTML pages: 7
- CSS files: 7
- SQL migration files: 17
- `.env` secrets: not included in release
- `node_modules`: excluded from release ZIP
- provider/mailbox legacy implementation: not present in runtime; remaining mentions are tests/docs describing what is intentionally absent or historical

## Verification results

After the fix:

- `node --check server.js` — PASS
- all project JS/MJS syntax checks — PASS
- `npm test` — PASS
- provider contract tests — 11 PASS
- provider diagnostic tests — 9 PASS
- flow/quota tests — 9 PASS
- regression — PASS
- runtime verifier — PASS

Total named test cases in the current suite: 29 PASS, 0 FAIL, plus regression/runtime verification.

## Remaining deployment-only requirements

The release ZIP does not contain:

- Supabase service-role key
- Supabase publishable key
- provider API key
- provider token encryption secret
- diagnostic/webhook secret
- live `.env`

A real deployment environment must supply these values. The actual live Step 1/2/3 network execution cannot be reproduced from this ZIP alone without those secrets.
