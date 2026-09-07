# JYY'R Ecosystem Production Recovery Audit
Date: 2026-09-05 (Asia/Jakarta)
Scope: JYY'R Amprem + JYY'R Token Center + Supabase/PostgreSQL + Vercel runtime contracts

## FINAL STATUS
NEEDS ATTENTION

This audit does **not** claim production is fixed. The source has been minimally corrected and automated regression checks pass, but production deployment/alias verification and authenticated end-to-end flow remain blocked by unavailable Vercel project access and the currently failing production Amprem API contract.

## Current decision matrix

| Area | Status | Evidence / reason |
|---|---|---|
| Amprem source | PASS | Syntax checks and full npm test pass; Vercel proxy trust fixed; `/health` alias added. |
| Token Center source | PASS | Existing Vercel proxy-trust, timeout and upstream error handling present; all 9 contract tests pass. |
| Amprem production | FAIL | `/health` and `/api/public/tokens` currently return 404 through live web verification. |
| Token Center production | FAIL | `/api/runtime-config` is 200 and points to Amprem; `/api/tokens` currently returns 502. |
| Cross-site connection | FAIL | Token Center is reaching an Amprem URL that does not expose the required public-token endpoint. |
| Supabase ecosystem schema | PASS | Required tables, RLS, service-role-only table grants, and canonical RPCs are present in live project. |
| Supabase security | FAIL | Supabase Security Advisor reports leaked-password protection disabled. |
| Automated regression | PASS | Amprem full test suite and Token Center contract suite pass locally. |
| Local runtime integration | BLOCKED | Extracted source has no node_modules; network/DNS from shell is unavailable. |
| Vercel deployment inspection | BLOCKED | Vercel CLI is not installed and connector access is not connected in this session. |
| Git baseline/history | BLOCKED | Uploaded archive contains no `.git` metadata. |
| Authenticated E2E | BLOCKED | Requires valid production/test user session and a deployed/fixed Amprem upstream. |

## Production live evidence

Verified live through external HTTP fetches:

- Amprem `/` returned HTML shell: `Jyy'R Amprem — Memuat Jyy'R Amprem...`.
- Amprem `/health` returned **404 Not Found**.
- Amprem `/api/public/tokens?limit=1&offset=0` returned **404 Not Found**.
- Token Center `/` returned Token Center UI.
- Token Center `/api/runtime-config` returned JSON with `ampremUrl = https://www.jyyramprem.my.id`.
- Token Center `/api/tokens?limit=1&offset=0` returned **502 Bad Gateway**.

These facts are production observations, not assumptions.

## Root cause assessment

### Primary production blocker: deployment drift
Confidence: HIGH

The supplied source contains the canonical Amprem routes:
- GET `/api/public/tokens`
- GET `/api/public/tokens/:id`
- POST `/api/access/token-center-link`
- POST `/api/ecosystem/handoff/inspect`
- POST `/api/ecosystem/handoff/consume`

The live Amprem deployment still returns 404 for `/api/public/tokens`. Therefore the live production deployment does not currently execute the supplied/fixed Amprem route set.

### Secondary source regression found: Amprem Vercel proxy trust
Confidence: HIGH

Amprem uses `express-rate-limit` but the supplied `server.js` did not set a bounded Vercel proxy trust. The repository's archived patch script explicitly expected:
`app.set("trust proxy", 1);`

This is now restored in the source as a Vercel-only setting. This is a minimal, security-bounded fix; it does not use `trust proxy = true`.

### Health endpoint contract mismatch
The supplied source originally exposed `/api/health`, while the requested production baseline probes `/health`. The source now maps both `/api/health` and `/health` to the same handler, preserving the old endpoint and adding the requested probe without duplicating health logic.

## Changes made in this recovery pass

1. `jyyramprem/server.js`
   - Added Vercel-only `app.set("trust proxy", 1)`.
2. `jyyramprem/api/routes/public.routes.js`
   - Extracted existing health handler to a single function.
   - Kept `/api/health`.
   - Added `/health` alias to the same handler.
3. `jyyramprem/test/runtime-contract.test.mjs`
   - Added regression coverage for bounded Vercel proxy trust.
   - Added regression coverage for both health routes sharing one handler.
4. `jyyrtoken/test/connection-contract.test.mjs`
   - Fixed the cross-project test path so it works with the supplied two-project archive layout instead of a hard-coded `/tmp/amprem/...` path.

No database mutation was performed during this recovery pass.

## Automated verification

### Amprem
- All JS/MJS syntax checks: PASS.
- `npm test`: PASS.
- Full suite groups reported zero failed / zero skipped in the executed suites.
- Runtime verifier: PASS.

### Token Center
- All JS/MJS syntax checks: PASS.
- All 9 contract tests: PASS.

### Local server runtime
BLOCKED because the supplied source archive does not include `node_modules`, and this shell environment cannot resolve external package registries.

## Supabase live verification
Project: `jfjbdenqepaagxfysaar`

Verified live:
- `jyyr_ecosystem_handoffs` exists with RLS enabled.
- `portal_token_publications` exists with RLS enabled.
- `portal_daily_distribution_quota` exists with RLS enabled.
- `portal_access_tokens` exists with RLS enabled.
- `portal_access_grants` exists with RLS enabled.
- `portal_verify_token(uuid,text)` is `SECURITY DEFINER`, callable by `service_role`, and not executable by `anon`/`authenticated`.
- `owner_publish_portal_token(uuid,uuid)` is `SECURITY DEFINER`, callable by `service_role`, and not executable by `anon`/`authenticated`.
- `owner_unpublish_portal_token(uuid,uuid)` is `SECURITY DEFINER`, callable by `service_role`, and not executable by `anon`/`authenticated`.
- Canonical security-definer functions have `search_path` set to the empty path.
- Ecosystem tables have service-role table privileges only in the inspected grant view.

Current data snapshot:
- 31 portal tokens total.
- 1 token has `published_at` set.
- 0 currently available published + active + unassigned + unexpired tokens.
- 0 handoff rows.

Supabase Security Advisor currently reports:
- `auth_leaked_password_protection` WARN: disabled.
- Multiple intentional `rls_enabled_no_policy` INFO findings on server-only tables.

Supabase Performance Advisor currently reports unused-index INFO findings and one multiple-permissive-policy WARN on `app_releases`. No indexes were removed.

## Security assessment

Positive controls confirmed in source/live schema:
- Service-role key is not used in browser assets.
- Ecosystem handoff state is opaque, hashed at rest, short-lived, and single-use.
- Handoff secret is used server-to-server.
- Token redemption uses atomic row locking/update semantics.
- Sensitive ecosystem tables are RLS-enabled and not granted to anon/authenticated roles.
- `trust proxy` is bounded to one hop in Token Center and now also Amprem.

Open security issue:
- Supabase leaked-password protection is disabled. This prevents final Security=PASS.

Dependency vulnerability scan:
- BLOCKED in this shell because registry/network access is unavailable.

## Git / deployment evidence limitations

The uploaded archive has no `.git` directory. Therefore these checkpoints cannot be honestly completed from the archive alone:
- current branch
- HEAD
- git status
- commit ancestry
- last-known-good/first-bad regression commit
- repository remote

Vercel CLI is not installed in the shell and the Vercel connector is not connected in this session. Therefore these cannot be honestly marked PASS:
- project inspect
- deployment inspect
- deployment READY state
- production alias target
- build artifacts/functions comparison
- production environment variable presence

## Required release gate before declaring VERIFIED FIXED

1. Deploy the corrected Amprem source to the `jyyramprem` production project.
2. Verify the deployment itself is READY and the production alias points to that deployment.
3. Verify Amprem:
   - `/`
   - `/health`
   - `/api/public/tokens?limit=1&offset=0`
   - `/api/public/tokens/:id` with a valid published token ID
4. Only after Amprem passes, verify Token Center:
   - `/`
   - `/health`
   - `/api/runtime-config`
   - `/api/tokens?limit=1&offset=0`
5. Verify matched `ECOSYSTEM_HANDOFF_SECRET` presence on both deployments without printing its value.
6. Execute authenticated handoff create → inspect → token listing → consume → redirect.
7. Run the full E2E registration/access path.
8. Enable Supabase leaked-password protection.
9. Re-run Security Advisor and relevant regression suites.
10. Re-check production alias/deployment drift and record final evidence IDs.

## Rollback readiness

Previous deployment identifiers supplied in incident context remain reference points only and must be re-inspected before use:
- known-good candidate: `dpl_BuUsxTziJbkc1xPqJ28t98NHYz53`
- known-error candidate: `dpl_9jYt48sbQADZasG4ucqJMeQmyT3D`

Do not rollback blindly. First inspect current production alias and deployment status, then choose the rollback target based on live evidence.

## Bottom line

The source-side ecosystem contracts are present and the recovery patch is locally validated. The production ecosystem is **not yet recovered** because the live Amprem deployment still lacks the required `/api/public/tokens` route, which keeps Token Center at 502. The correct next gate is a controlled Amprem production deployment and live verification before any Token Center redeployment or E2E claim.
