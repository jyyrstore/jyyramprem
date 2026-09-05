# JYY'R Ecosystem — Full Audit & Integration Report

Date: 2026-09-05
Scope: JYY'R Amprem + JYY'R Token Center + Supabase integration + Vercel runtime contract

## PROJECT STATUS

**Overall Status: NEEDS ATTENTION — source code corrected, production deployment must be redeployed and externally rechecked.**

| Area | Status | Finding |
|---|---|---|
| Build | PASS* | No build script is defined; every JS/MJS source passed `node --check`, architecture/runtime verification passed. |
| Tests | PASS | Full Amprem suite passed; Token Center suite and new integration contract tests passed. |
| Frontend ↔ Backend | PASS | Route and payload contracts are present and consistent in the fixed source. |
| Database / Supabase | PASS | Required token tables/RPCs exist in the live AM Account Portal project. |
| Cross-site Integration | NEEDS ATTENTION | Source is connected correctly; the logged Vercel deployment is stale and was returning an older `/api/runtime-config` response plus `/api/tokens` 404. |
| Security | NEEDS ATTENTION | Supabase leaked-password protection remains disabled in platform configuration. |
| Deployment | NEEDS ATTENTION | Production Token Center must be redeployed from the fixed source; production env values must point to the correct Amprem URL and shared handoff secret. |

\* `package.json` defines no build command, so this project is runtime/serverless-oriented rather than build-artifact-oriented.

## FILE STRUCTURE

### Token Center

Before: 9 source/config/test files (excluding dependency tree).
After: 11 files including 2 new regression tests.
Modified: 3 source/config files (server.js, .env.example, tests) plus 1 new integration test file.
Removed: 0.

### Amprem

Before: 255 files / 31 directories (excluding dependency tree).
After: 253 files / 31 directories after removing 2 exact duplicate report copies.
Modified: app.config.js, app-runtime.js, member.routes.js, Token Center migration, app-release test, quota test.
Added: cross-site contract test is stored in the Token Center test suite because it validates both projects.
Removed: `docs/JYYR_AMPREM_REFACTOR_REPORT.md` and `.json`, both exact duplicates of the canonical copies under `docs/reports/` and not referenced by runtime/build/test code.

## ROOT CAUSE FOUND

The Vercel log:

`GET /api/tokens -> 404` with `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`

was not caused by the Token Center route being absent in the supplied source. The route exists and proxies:

`GET /api/tokens` → `AMPREM_URL/api/public/tokens`

The Amprem source also exposes the canonical upstream endpoint:

`GET /api/public/tokens`
`GET /api/public/tokens/:id`

The deeper inconsistency was deployment drift: the production deployment reported by the user returned only `{ok:true,service:"jyyr-token-center"}` from `/api/runtime-config`, while the supplied source already contains `{ok:true,ampremUrl:...}`. That proves the logged deployment is not the same source revision as the supplied/fixed project.

The production `X-Forwarded-For` error is caused by `express-rate-limit` receiving Vercel's forwarded header while Express still uses the default `trust proxy = false`.

## FIXES APPLIED

### 1. Token Center Vercel proxy trust

File: `token/jyyrtoken/server.js`

Change: when `VERCEL` is present, Express now trusts exactly one proxy hop:

`app.set("trust proxy", 1)`

Reason: fixes `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` while avoiding an unsafe blanket `trust proxy = true`.

Verification: regression test passes.

### 2. Token Center upstream validation and timeout

File: `token/jyyrtoken/server.js`

Changes:
- `AMPREM_URL` must be HTTP/HTTPS.
- Server-to-server proxy requests get a bounded timeout (default 10s).
- A missing `/api/public/tokens` endpoint is surfaced as `502` with code `AMPREM_ENDPOINT_NOT_FOUND` instead of masquerading as a Token Center route 404.

Reason: makes the cross-site failure mode explicit and prevents indefinite upstream waits.

### 3. Amprem ESM filesystem path correctness

File: `amprem/jyyramprem/lib/config/app.config.js`

Change: `PUBLIC_DIR` now uses `fileURLToPath(new URL(...))` rather than using the raw URL pathname.

Reason: URL pathname handling can retain escaped filesystem characters such as `%20`, which is unsafe on Android paths containing spaces.

### 4. Amprem magic-link quota runtime export

Files:
- `amprem/jyyramprem/lib/runtime/app-runtime.js`
- `amprem/jyyramprem/api/routes/member.routes.js`

Change: `MAGIC_LINK_DAILY_LIMIT` is exported from the canonical runtime object and consumed by member routes.

Reason: removes the runtime `ReferenceError: MAGIC_LINK_DAILY_LIMIT is not defined` previously observed.

### 5. Migration correctness

File: `amprem/jyyramprem/supabase/migrations/20260905000000_jyyr_ecosystem_token_center_v1.sql`

Change: UUID aggregation uses `min(user_id::text)::uuid` instead of applying `min()` directly to UUID.

Reason: PostgreSQL does not provide a native `min(uuid)` aggregate.

### 6. Duplicate report cleanup

Removed only exact duplicate report files after repository-wide reference search confirmed no runtime/build/test consumer depends on them.

### 7. Regression coverage

Added tests for:
- Vercel proxy trust configuration.
- HTTP/HTTPS Amprem URL contract.
- finite upstream timeout.
- explicit upstream endpoint-missing handling.
- Token Center ↔ Amprem handoff contract.
- Token Center ↔ Amprem token endpoint contract.
- registration redirect and token context preservation.
- canonical `MAGIC_LINK_DAILY_LIMIT` export.
- filesystem-safe `PUBLIC_DIR` resolution.

## CROSS-SITE CONNECTION MAP

Amprem browser login gate
→ `POST /api/access/token-center-link`
→ Amprem creates short-lived hashed handoff state in `jyyr_ecosystem_handoffs`
→ redirect to `TOKEN_CENTER_URL?state=...`
→ Token Center `POST /api/handoff/inspect`
→ Token Center sends `Authorization: Bearer <shared secret>` to Amprem `/api/ecosystem/handoff/inspect`
→ Token Center lists published tokens from Amprem `/api/public/tokens`
→ selected token fetched through Token Center `/api/tokens/:id`
→ Token Center consumes handoff via Amprem `/api/ecosystem/handoff/consume`
→ Token Center redirects to Amprem `/login.html?mode=register&username=...&token_id=...`
→ Amprem stores `jyyr:selected_token_id` and continues the canonical registration/access flow.

The source contracts for every arrow above are present and tested.

## LIVE SUPABASE CHECK

Connected live project: `AM Account Portal` (`jfjbdenqepaagxfysaar`)

Verified:
- `portal_access_tokens` exists.
- `portal_token_publications` exists.
- `portal_daily_distribution_quota` exists.
- `jyyr_ecosystem_handoffs` exists.
- `portal_access_grants` exists.
- canonical `portal_verify_token(uuid,text)` exists as `SECURITY DEFINER`.
- `owner_publish_portal_token(uuid,uuid)` exists as `SECURITY DEFINER`.
- `owner_unpublish_portal_token(uuid,uuid)` exists as `SECURITY DEFINER`.

Current data snapshot:
- 31 portal access tokens total.
- 1 published token.
- 0 currently available published+active+unassigned tokens.
- 0 handoff rows at audit time.

No data mutation was performed during this audit.

## SUPABASE SECURITY ADVISORS

The live security advisor reports many `RLS enabled, no policy` findings on intentionally server-only tables. Those tables are paired with server/RPC access patterns and were not opened merely to silence the advisor.

A confirmed platform-level issue remains:

**Leaked Password Protection is disabled.**

This is an external Supabase Auth setting and cannot be repaired safely by changing application source code. It should be enabled in the Supabase Auth security configuration.

Supabase's current API security guidance recommends using grants plus RLS for exposed objects and reviewing `SECURITY DEFINER` functions carefully. The token tables/functions follow the server-only pattern in the current project schema. See Supabase documentation for Data API security and RLS. 

## PERFORMANCE ADVISORS

Supabase reports unused-index informational findings and one multiple-permissive-policy warning on `app_releases`.

No indexes were removed because unused-index status alone is not enough evidence that an index is obsolete in a production workload. Removing them without usage-history context could cause regressions.

## DEAD CODE / DEAD FILE REVIEW

No high-confidence runtime dead source file was deleted.

Candidates were checked across:
- static source references
- route registration
- frontend calls
- test references
- configuration references
- scripts
- deployment files
- dynamic/string-based route patterns

The only deletion made was the pair of exact duplicate documentation reports described above.

## DUPLICATION REVIEW

Exact duplicate implementation groups in runtime code: none found in the audited source.

Exact duplicate documentation group: one pair of report copies, removed from the non-canonical location.

Legacy/compatibility code remains where explicit tests and migration compatibility still depend on it. It was not removed speculatively.

## ENVIRONMENT / DEPLOYMENT CONTRACT

### Amprem
Required cross-site variables:
- `TOKEN_CENTER_URL`
- `ECOSYSTEM_HANDOFF_SECRET`

### Token Center
Required cross-site variables:
- `AMPREM_URL`
- `ECOSYSTEM_HANDOFF_SECRET`

Token Center also supports:
- `TOKEN_LIST_LIMIT`
- `AMPREM_TIMEOUT_MS`

No secret values were printed into this report.

## VERIFICATION RESULTS

### Amprem
- Full `npm test`: PASS.
- Architecture verification: PASS.
- Runtime verification: PASS.
- All JS/MJS syntax checks: PASS.

Runtime verifier metrics:
- 80 route paths.
- 78 API route handlers.
- 64 unique API paths.
- 53 RPC references.
- local frontend references: OK.

### Token Center
- Existing contract test: PASS.
- New Vercel runtime contract tests: PASS.
- New cross-site connection contract tests: PASS.
- All JS/MJS syntax checks: PASS.

## PRODUCTION DEPLOYMENT BLOCKER

The supplied Vercel logs are from deployment `dpl_6rnski1gjfW4qSHjomFrLx2hSjUL`.

Because that deployment returned the old `/api/runtime-config` payload, the production service is stale relative to the corrected source.

Therefore the project is **not yet honestly classifiable as fully production-verified** until:

1. Token Center is redeployed from the fixed source.
2. Production `AMPREM_URL` points to the live Amprem deployment containing `/api/public/tokens` and `/api/ecosystem/handoff/*`.
3. Both sites use the same `ECOSYSTEM_HANDOFF_SECRET` value.
4. After redeploy, verify:
   - `GET /health` → 200
   - `GET /api/runtime-config` → includes `ampremUrl`
   - `GET /api/tokens?limit=1&offset=0` → 200 (or a meaningful 502 if Amprem is unavailable)
   - Amprem login `GET TOKEN` → opens Token Center with `state`
   - Token Center handoff inspect/consume → authenticated
   - Token selection → redirects back to Amprem login with `username` and `token_id`

## CURRENT CONCLUSION

The source-level architecture is now coherent and the broken runtime contracts found during this audit have been fixed with minimal changes.

The remaining blocker is **deployment drift**, not an unresolved route design problem: production Token Center must be redeployed from the corrected source and pointed at the live Amprem deployment with the matching shared secret.
