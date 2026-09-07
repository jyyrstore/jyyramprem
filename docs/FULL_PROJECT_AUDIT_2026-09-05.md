# JyyR Amprem — Full Project Audit Report
Date: 2026-09-05

## PROJECT STATUS

Overall Status: **Needs Attention (live deployment/configuration verification remains)**
Build: **PASS** (all available project verification/test suites pass)
Tests: **PASS**
Integration: **PARTIAL — fixed live DB drift for Token Center; external provider and production env still require live verification**
Database: **PASS for inspected live schema/RPC/RLS baseline; remaining Supabase advisor findings are documented below**
Frontend ↔ Backend: **PASS on static contract and route/reference checks**
Security: **PASS with remaining hardening action: leaked-password protection is disabled in Supabase Auth**

## SCOPE

Audited the complete `jyyramprem` source tree, including:
- application/server code
- API routes and middleware
- frontend HTML/CSS/JS/PWA assets
- configuration and environment contract
- package manifest/lockfile
- tests and verification scripts
- all 45 SQL migration files
- archived/legacy documentation and scripts
- live Supabase project schema, functions, RLS state, triggers and advisors

Inventory before: 255 files / 31 directories.
Inventory after source cleanup: 255 files / 31 directories.
No source file was deleted because no candidate could be proven safe to remove without runtime/external-consumer risk.

## ARCHITECTURE MAP

Browser/PWA
→ `public/js/*`
→ `/api/*`
→ Express route modules in `api/routes/*`
→ auth/owner/rate-limit middleware
→ `lib/runtime/app-runtime.js`
→ `lib/repositories/supabase.repository.js`
→ Supabase admin client / Auth / Postgres / Storage
→ external provider API where applicable.

Composition root:
`server.js` → route modules + middleware + runtime dependency object.

The architecture verifier passed and reported all required composition boundaries present.

## TRACE RESULTS

### API
- 78 API handlers detected by the project's runtime verifier.
- 64 unique API paths in the verifier's contract view.
- 53 RPC names referenced by runtime code.
- Every runtime-referenced RPC name was found in the migration source set.
- No missing local route handler was found for the frontend's referenced API endpoints.

### Frontend ↔ Backend
Checked fetch targets, auth/config flow, magic-link flow, portal-token flow, release flow, member messaging/notifications, and owner UI contracts.
No broken local endpoint reference was found.

### Database
All 24 inspected public base tables have RLS enabled in the live project.
Critical service-side mutations use SECURITY DEFINER functions with explicit `search_path=''` in the canonical migrations/runtime model.
The live database was checked directly rather than assuming the local migration folder was applied.

## CONFIRMED ISSUE FIXED

### Token Center production drift
Source code already contained:
- `/api/access/token-center-link`
- `/api/ecosystem/handoff/inspect`
- `/api/ecosystem/handoff/consume`
- `/api/owner/token/publish`
- `/api/owner/token/unpublish`

But the live Supabase project was missing:
- `jyyr_ecosystem_handoffs`
- `portal_token_publications`
- `portal_daily_distribution_quota`
- `owner_publish_portal_token`
- `owner_unpublish_portal_token`

This was a real source→database connection break.

Fix applied live:
- created the three required tables
- added publication columns/indexes
- installed canonical publish/unpublish RPCs
- updated `portal_verify_token` so only published tokens are redeemable
- granted execution only to `service_role`
- added indexes covering new foreign keys

Current live token inventory: 30 tokens, all currently `used` or `revoked`; no existing active token was invalidated by this change.

### Migration bug fixed in source
`supabase/migrations/20260905000000_jyyr_ecosystem_token_center_v1.sql`
contained `min(user_id)` where `user_id` is UUID. PostgreSQL has no `min(uuid)`.
Changed to `min(user_id::text)::uuid`, preserving the intended unique-candidate backfill.

The migration was also updated with indexes for the newly introduced foreign keys.

## DEAD CODE / DEAD FILES

Found candidates, but **removed: 0**.

Kept because removal was not provably safe:
- historical SQL RPCs such as `owner_list_portal_tokens` and other legacy overload remnants that are no longer called directly by current runtime code but may be part of an external/manual deployment contract.
- old trigger helper functions that are no longer attached to active triggers.
- archived patch scripts and historical documentation under `docs/archive`.

The active runtime has no unresolved local import dependency caused by these items.

## DUPLICATION

### Confirmed / intentional historical duplication
The migration history contains many `CREATE OR REPLACE FUNCTION` revisions for the same logical RPCs. This is expected migration history, not duplicate runtime implementations.

### Current runtime
A single canonical application composition root exists.
Portal token history intentionally reads through the service-role repository instead of the obsolete owner token-list RPC overloads.

No high-confidence runtime code duplicate was removed because the remaining duplicated helpers (`escapeHtml`, pagination helpers, etc.) are small and context-specific; consolidating them would add regression risk without functional benefit.

## SECURITY

Positive findings:
- service-role key is not referenced by public frontend code.
- `/api/config` exposes only the Supabase URL + publishable key.
- auth boundary calls Supabase `auth.getUser(token)`.
- suspended/banned state is checked at the auth boundary.
- owner checks are enforced both at middleware and privileged RPC level.
- provider ID tokens are encrypted at rest and not returned to the frontend.
- provider diagnostic output is sanitized.
- portal token redemption is atomic and one-token/one-user.
- new ecosystem handoff state is opaque, hashed at rest, short-lived and single-use.
- public ecosystem tables have RLS enabled and service-role-only mutation paths.

Remaining confirmed Supabase advisory:
- **Leaked Password Protection is disabled.**
This is an Auth project setting rather than a repository SQL change and should be enabled in the Supabase Auth dashboard/configuration.

Supabase advisor also reports RLS-enabled tables with no policies. In this project those tables are intentionally service-role/RPC-only in the current architecture, so the absence of public policies is not automatically a vulnerability; the access model should remain explicitly documented.

## PERFORMANCE

Supabase advisor still reports several unused indexes. These were **not removed** because advisor usage statistics alone are insufficient proof that an index is obsolete; some are protective/foreign-key/query-path indexes.

The new ecosystem foreign-key indexes were added after advisor feedback. They are currently unused because the feature has no publication/handoff rows yet.

One warning remains:
- `app_releases` has multiple permissive SELECT policies for `authenticated`.
This is primarily a policy evaluation/performance warning, not evidence of incorrect authorization. Consolidation was intentionally deferred to avoid changing access semantics.

## ENVIRONMENT / DEPLOYMENT

`.env.example` is complete for the variables referenced by the source.
No secret value was copied into this report.

Production readiness still depends on externally supplied values for:
- Supabase URL and keys
- provider base URL/API key
- provider token encryption key
- ecosystem handoff secret
- Token Center URL
- deployment-specific cron/owner values

The source contains no hardcoded service-role/provider secret in public assets.

## TEST / VERIFICATION

- Node syntax check: **PASS**
- `node scripts/verify-architecture.mjs`: **PASS**
- `npm test`: **PASS**
- Runtime verifier: **PASS**
- Live Supabase schema/RPC inspection: **PASS for the repaired Token Center contract**
- Supabase security advisor: **remaining Auth hardening warning**
- Supabase performance advisor: **informational unused-index findings + one multiple-policy warning**

## CHANGES MADE

| File / Component | Change | Reason | Risk | Verification |
|---|---|---|---|---|
| `supabase/migrations/20260905000000_jyyr_ecosystem_token_center_v1.sql` | Fixed UUID aggregate cast; added new FK indexes | Migration was not executable as written; advisor identified missing FK indexes | Low | Syntax + full test suite + live SQL |
| Live Supabase DB | Installed Token Center tables/RPCs and canonical published-token redemption | Source/database drift broke the feature | Medium, controlled | Direct SQL inspection + advisors |
| Live Supabase DB | Added FK indexes | Performance advisor | Low | Advisor rerun |

Files added: 0
Files removed: 0
Files modified: 1

## BROKEN CONNECTIONS FOUND

1. **Token Center application → Supabase schema**
   - Expected: ecosystem handoff/publication tables and publish RPCs
   - Actual before fix: absent
   - Fix: installed canonical DB contract.

2. **Migration source → PostgreSQL type system**
   - Expected: unique UUID candidate backfill
   - Actual: `min(uuid)` call, invalid in PostgreSQL
   - Fix: cast UUID to text for aggregate, cast back to UUID.

No other high-confidence broken local connection was found.

## REMAINING ISSUES

### CONFIRMED
1. Supabase Auth leaked-password protection is disabled.
2. Local `node_modules` in the extracted audit environment is incomplete/mismatched, although the available test suite executes successfully. This is an environment artifact, not evidence that `package.json` is wrong.
3. The live migration history has generated migration names/timestamps that differ from the source archive names. The schema is repaired directly, but deployment tooling should reconcile migration history before applying the source folder automatically.

### POSSIBLE
1. Some legacy SQL functions remain callable in the live database even though current application runtime no longer calls them directly.
2. Several indexes are currently unused according to Supabase statistics; they may become useful under production load.
3. The external provider's real request/response behavior cannot be proven from the repository alone without exercising it with valid production credentials.

### REQUIRES EXTERNAL VERIFICATION
1. Enable leaked-password protection in Supabase Auth.
2. Verify the actual deployment environment contains all required secrets/configuration.
3. Verify Token Center's receiving implementation accepts the exact opaque `state` handoff contract.
4. Exercise the external provider send → mailbox → verify → premium activation flow with real non-production/test credentials if available.

## FINAL ASSESSMENT

The project is **not safe to label “fully production-verified” yet**, because external provider behavior, deployment environment, Auth dashboard hardening, and migration-history reconciliation require environment-level verification.

Within the repository and the connected Supabase project, the audit found and repaired the most concrete integration break, preserved existing behavior, avoided risky dead-code deletion, and re-ran the complete available automated verification successfully.
