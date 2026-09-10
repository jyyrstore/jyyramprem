# FULL PROJECT AUDIT — 2026-09-10

## PROJECT STATUS

**Overall Status: Needs Attention**

The application source is structurally consistent and the complete local regression suite passes, but production/database state has two operational/security items that are outside safe source-only cleanup: migration-ledger drift and Supabase leaked-password protection being disabled.

### Verification matrix

| Area | Status | Evidence |
|---|---|---|
| Build | PASS (no dedicated build script) | `package.json` has no build step; all JS/MJS syntax checks pass |
| Tests | PASS | `npm test`: 131/131 tests passed |
| Architecture contract | PASS | `node scripts/verify-architecture.mjs` passed |
| Runtime contract | PASS (local config not live) | `node scripts/verify-runtime.mjs` passed; local `.env` absent |
| Frontend ↔ Backend route references | PASS | static import/path checks pass; contract tests pass |
| Database schema presence | PASS | live Supabase queried successfully |
| Token RPC security | PASS | canonical token RPCs are `SECURITY DEFINER`, execute granted to `service_role` only |
| Token runtime semantics | PASS | live `portal_verify_token(uuid,text)` matches direct-redemption contract |
| Deployment state | NEEDS ATTENTION | live migration ledger stops at `20260904122452` while later source changes are present in the live schema |
| Security | NEEDS ATTENTION | Supabase advisor reports leaked-password protection disabled |

## FILE STRUCTURE

- Source package files before audit: **228**
- Source package files after audit: **229**
- Files added: **1** — `docs/reports/FULL_PROJECT_AUDIT_2026-09-10.md`
- Files modified: **3** — `APP_RELEASE_README.md`, `docs/README.md`, `docs/migration/MIGRATION_CANONICAL_ORDER.md`
- Files removed: **0**
- Generated/build/cache/backup artifacts found in the source archive: none requiring removal.

The source tree was inventoried from root through API, middleware, runtime, frontend JS/CSS/assets, scripts, tests, Supabase migrations, and documentation.

## DEAD CODE / DEAD FILE

### Confirmed
No source file was removed during this audit solely from name-based suspicion. Static dependency analysis found no broken local import target or broken local HTML reference.

`public/assets/Foto/app_icon_2.png` has no textual reference, but it was **kept** because image assets may be used by external consumers or deployment configuration that is not represented by repository text.

### Kept for safety
The live database contains both `claim_initial_owner()` and `claim_initial_owner(uuid)`. The application source calls the parameterized form. The zero-argument overload is therefore a **likely legacy overload**, but it was not removed because external/manual callers cannot be proven absent from repository-only evidence.

## DUPLICATION

No duplicate HTTP method + path definitions were found in the seven active route modules.

The runtime intentionally retains middleware factory exports for historical contract tests, while `server.js` creates the canonical middleware instances used by route registration. This is not currently a runtime correctness issue and was left untouched to avoid breaking established contracts.

## BROKEN CONNECTION

### 1. Migration ledger → source migration set

**Component**
Live Supabase migration history

**Expected dependency**
The later Token Center/direct-redemption source migrations should have corresponding migration history entries before deployment tooling treats the source directory as replayable.

**Actual dependency**
The live database contains the Token Center tables and the latest direct-redemption `portal_verify_token()` implementation, but the migration ledger ends at `20260904122452`.

**Problem**
Schema state and migration ledger are not authoritative from the same history. Blindly replaying the source migration directory against this production database is unsafe.

**Fix**
Source documentation was corrected to flag the drift explicitly. No production migration-history row was fabricated and no destructive reconciliation was performed automatically.

**Status: CONFIRMED**

### 2. Legacy token ciphertext

**Component**
`portal_access_tokens.token_encrypted`

**Expected dependency**
Newly generated tokens have encrypted storage so Owner history can recover plaintext after process restart.

**Actual dependency**
13 legacy rows have no ciphertext.

**Problem**
Those legacy token values cannot be recovered from `token_encrypted` after process restart.

**Mitigation/verification**
All 13 missing-ciphertext rows are `revoked`; no active token currently suffers from this data-loss condition.

**Status: CONFIRMED, non-active legacy data only**

### 3. Token redemption

No broken runtime connection was found. Live `portal_verify_token(uuid,text)`:

- accepts an active unassigned token without requiring `published_at`;
- enforces the 24-hour redemption window;
- assigns exactly one user atomically under row lock;
- computes member access from `duration_mode` (`15_days`, `30_days`, `permanent`);
- writes the grant and preserves single-user binding.

**Status: CONFIRMED HEALTHY**

## TOKEN DAMAGE CHECK

Live production snapshot:

- Total token rows: **40**
- Active: **1**
- Used: **12**
- Revoked: **27**
- Currently redeemable: **1**
- Missing encrypted token ciphertext: **13**, all revoked

Canonical live constraints include:

- unique `token_hash`
- state/assignment consistency check
- redemption window check
- supported duration modes
- FK to the creating/assigned/authenticated users

Canonical token RPC privileges:

- `anon`: no execute
- `authenticated`: no execute
- `service_role`: execute

This is the desired server-side privilege boundary for the current architecture.

## SECURITY

Supabase security advisor findings:

1. **WARN — Leaked Password Protection disabled.** This should be enabled in the Supabase Auth settings. This is an external project setting, not a safe source-code-only patch.
2. **INFO — 19 tables with RLS enabled and no policies.** These tables are service-role/server-only in the current architecture and application access is mediated through server-side RPCs. Do not add broad policies without re-evaluating the threat model.

## PERFORMANCE

Supabase performance advisor reports 21 unused indexes and one multiple-permissive-policy warning on `public.app_releases`.

These are **not automatically removed** because usage counters are workload-dependent and dropping indexes/policies can create regressions. Revisit after observing production query plans and workload statistics.

## DOCUMENTATION FIXES

1. Removed the obsolete `/app.html` claim from `APP_RELEASE_README.md`; the project is single-entry and the active App Center contract is `/app`.
2. Clarified environment-variable responsibilities in `docs/README.md`, including worker-only variables.
3. Updated `docs/migration/MIGRATION_CANONICAL_ORDER.md` so the direct-redeem migration is recognized as the latest source correction and the production migration-ledger drift is explicit.

## VERIFICATION

Executed successfully:

```text
node --check on all JS/MJS files: PASS
node scripts/verify-architecture.mjs: PASS
node scripts/verify-runtime.mjs: PASS (local Supabase not configured)
npm test: PASS — 131 tests, 0 failed
```

Live Supabase verification executed successfully against project `jfjbdenqepaagxfysaar`:

- public table inventory
- migration ledger inventory
- current token RPC definitions
- token RPC execute privileges
- token schema columns/constraints
- token population/status counts
- Supabase security advisors
- Supabase performance advisors

No secrets, passwords, access tokens, or API keys were printed or persisted in the audit artifact.

## REMAINING ISSUES

### CONFIRMED ISSUE

- Production migration ledger drift: live schema contains later Token Center/direct-redemption state not represented by migration-history entries.
- Supabase leaked-password protection is disabled.
- 13 legacy revoked token rows have no encrypted plaintext recovery field.

### POSSIBLE ISSUE

- 21 reported unused indexes may be removable, but this requires workload-aware confirmation rather than static deletion.
- The `claim_initial_owner()` zero-argument RPC overload appears legacy/unreferenced by the application source, but external callers cannot be ruled out.

### REQUIRES EXTERNAL VERIFICATION

- Full end-to-end authenticated browser flow (register → OTP → login → token redemption → portal access) against production.
- External provider API success/error behavior with real provider credentials.
- Vercel production environment variable completeness and actual deployment revision.
- Safe reconciliation of Supabase migration history with the already-present later schema objects.

## CONCLUSION

At the time of this report the source project is **UNDERSTOOD and locally VERIFIED**. The portal-token source contract is now 12 characters (`JYYR` + 8 uppercase hex) and is covered by source-level regression tests. Live production state remains outside a ZIP-only verification boundary.
## Follow-up token validation fix (2026-09-10)

Historical baseline finding: the Owner token generator originally returned `JYYR` + 16 uppercase hexadecimal characters (20 characters total), while several validators expected the wrong shape. The current corrective contract is `JYYR` + 8 uppercase hexadecimal characters (12 characters total), with backend and frontend validators aligned to `^JYYR[A-F0-9]{8}$`.

Current implementation uses the single canonical validation contract: `^JYYR[A-F0-9]{8}$`. The Owner input limit is 12 characters. Regression coverage verifies the 4-byte generator and the 12-character validator contract.

