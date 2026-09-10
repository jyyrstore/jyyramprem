# Jyy'R Amprem — Full Project Audit & Stabilization Report

**Audit date:** 2026-09-10  
**Scope:** Entire uploaded archive from repository root: structure, source, frontend, backend, API routing, authentication, configuration, dependency manifests, Supabase migrations/integration contracts, tests, deployment config, assets, documentation, dead-code/file candidates, duplication, and cross-component references.

## 1. PROJECT STATUS

**Overall Status: NEEDS EXTERNAL VERIFICATION — source tree is clean/stable after targeted fixes, but live Supabase/provider/Vercel runtime cannot be proven from the uploaded archive alone.**

| Area | Result | Evidence / limitation |
|---|---|---|
| Build | **NOT VERIFIED** | No `build` script exists. Source syntax and architecture checks pass. A dependency install was attempted, but `npm ci` timed out in the sandbox, so a true runtime import/build was not completed. |
| Tests | **PASS** | Full `npm test` passed after the cleanup changes. |
| Integration | **PASS STATICALLY / EXTERNAL PENDING** | Frontend references resolve to active API contracts; external provider delivery/auth flows require real environment credentials and runtime verification. |
| Database | **PASS ON SOURCE CONTRACT / LIVE PENDING** | 26 public application tables are represented in migrations and runtime RPC references are accounted for; live schema/migration ledger cannot be re-queried without configured Supabase credentials. |
| Frontend ↔ Backend | **PASS STATICALLY** | Single-entry SPA routing, API paths, auth gate, token contract, and route composition checks pass. |
| Security | **PASS ON INSPECTED CODE PATHS / EXTERNAL PENDING** | Server-side owner/member authorization, RLS-oriented migrations, secret separation, rate limiting, provider diagnostics, and token handling were inspected. Dashboard-only settings cannot be verified from source. |
| Deployment | **READY BASELINE / REDEPLOY + RUNTIME CHECK REQUIRED** | `vercel.json` and Node runtime contract are coherent; this archive was not deployed during the audit. |

## 2. REPOSITORY INVENTORY

### Files

- **Files before cleanup:** 251
- **Files after cleanup:** 232
- **Files removed:** 19 files total: 18 verified backup/rollback artifacts plus 1 duplicate audit-report alias
- **Files added:** 0
- **Files modified:** 5 project files (`server.js`, migration metadata, removal register, cleanup contract test) plus this audit report

### Top-level distribution after cleanup

| Area | Count |
|---|---:|
| `public/` | 94 |
| `supabase/` | 47 |
| `docs/` | 29 |
| `test/` | 24 |
| `lib/` | 16 |
| `api/` | 12 |
| `scripts/` | 3 |
| `tests/` | 1 |
| root files | 7 |

### Hidden/config files inspected

- `.env.example`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `vercel.json`

No `.env` secret file was present in the uploaded archive.

## 3. ARCHITECTURE MAP

```text
public/index.html
   ↓
public/js/auth-client.js + public/js/router.js
   ↓
view-specific browser modules
   ↓
/api/*
   ↓
server.js (composition root)
   ↓
route modules + middleware
   ↓
lib/runtime/app-runtime.js
   ↓
Supabase repository/client + provider helpers
   ↓
Supabase Auth / Postgres / Storage / external provider
```

### Backend composition

```text
server.js
  ├─ security headers / cache policy / static serving
  ├─ canonical rate-limit factory
  ├─ auth middleware
  ├─ owner middleware
  ├─ 7 active API route modules
  └─ error middleware
```

### Frontend composition

```text
single public/index.html
  ├─ login
  ├─ home
  ├─ dashboard
  ├─ setting
  ├─ owner
  ├─ app
  ├─ help
  ├─ maintenance
  └─ reset-password
```

## 4. CODE TRACE / CONNECTION AUDIT

### API routing

Static inventory after cleanup:

- 7 active API route modules
- 83 active route registrations across route modules
- 83 unique method/path pairs in the active route source
- 53 distinct runtime RPC references
- `server.js` remains the only application composition root

No confirmed duplicate active HTTP method/path pair was found.

### Frontend → backend

Frontend references were normalized against active route templates. No confirmed orphaned active frontend API target was found.

Known endpoints without a direct browser consumer were retained when they are operational/server-to-server/compatibility surfaces, including internal webhooks, Owner claim/status routes, and some Owner moderation endpoints. They were **not** deleted solely because static browser references were absent.

### Authentication

Protected path remains:

```text
Bearer access token
  ↓
Supabase Auth getUser()
  ↓
server-side owner/member status checks
  ↓
maintenance gate / portal-access gate
  ↓
route handler
  ↓
RPC / trusted database access
```

Owner privilege is determined server-side with `isOwner(user.id)` and is not inferred from the URL path.

## 5. DATABASE / SUPABASE AUDIT

### Source inventory

- **26 public base tables** represented by the migration source.
- Portal token subsystem includes the canonical one-token/one-user contract, separate redemption/access clocks, owner history, publication/distribution, and ecosystem handoff tables.
- Application RPC calls are represented by migration-defined functions in the source tree.
- Sensitive mutations are designed around server-side RPC/service-role access.

### Canonical portal-token contract verified in source

```text
Owner generates token
  ↓
24-hour redemption window
  ↓
first successful redemption atomically assigns exactly one user
  ↓
access lifetime = 15 days / 30 days / permanent
```

The latest source correction `20260910040000_direct_redeem_owner_tokens_v1.sql` intentionally supersedes only the publication requirement: generation/publication are separate inventory/distribution concerns, while redemption does not require `published_at`.

### Migration metadata issue found and fixed

The migration directory contains **46** SQL migrations, while the existing metadata still contained historical text claiming **45** source migrations. That inconsistency was corrected in:

- `docs/migration/MIGRATION_SYNC_MANIFEST.json`
- `docs/migration/MIGRATION_PRODUCTION_BASELINE.json`

The production baseline remains explicitly documented as historical metadata, not proof of the current live schema.

## 6. DEAD CODE

### Confirmed dead code

The source already contains the earlier cleanup of the private duplicate `safeNumber()` in `lib/utils/time.js`; the canonical implementation is `lib/utils/numbers.js::safeNumber()`.

No new executable dead function was removed during this audit because the remaining candidates are either exported runtime helpers, browser globals intentionally shared by feature scripts, server-to-server endpoints, or compatibility APIs with uncertain external consumers.

### Decision policy

Static "zero import" was **not** treated as sufficient proof of dead code. Dynamic browser loading, global feature wiring, scheduled workers, server-to-server calls, and compatibility endpoints were checked before making deletion decisions.

## 7. DEAD FILES / BACKUPS

### Confirmed dead/duplicate files removed: 19

All 18 were verified as rollback/backup artifacts located under `public/`, had no active references, and would otherwise be exposed by static serving.

Removed:

- `public/index.html.before-safe-rollback`
- `public/index.html.token-ui-backup-20260910_091920`
- `public/index.html.token-final-backup`
- `public/index.html.token-aurora-backup`
- `public/css/owner.css.before-safe-rollback`
- `public/css/owner.css.token-final-backup`
- `public/css/owner.css.token-ui-backup-20260910_091920`
- `public/css/owner.css.bullet-state-backup`
- `public/css/owner.css.token-aurora-backup`
- `public/css/owner.css.final-token-backup`
- `public/js/owner/core.js.before-safe-rollback`
- `public/js/owner/portal-token.js.token-ui-backup-20260910_091920`
- `public/js/owner/portal-token.js.token-aurora-backup`
- `public/js/owner/events.js.before-safe-rollback`
- `public/js/owner/portal-token.js.before-safe-rollback`
- `public/js/owner/portal-token.js.token-final-backup`
- `public/js/owner/events.js.token-ui-backup-20260910_091920`
- `public/js/owner/core.js.token-ui-backup-20260910_091920`

The final cleanup contract test now prevents rollback/backup artifacts from returning to `public/`.

## 8. BROKEN CONNECTIONS

### Confirmed broken route: `/app-intro.html`

```text
server.js
  ↓
GET /app-intro.html
  ↓
expected legacy page
  ↓
public/app-intro.html
  ↓
MISSING
```

There was no file target, no active frontend consumer, and the single-entry migration contracts already treat `app-intro.html` as obsolete. The dead route registration was removed.

### Other candidate connections

No other confirmed broken active source-to-source dependency was found during static tracing.

## 9. DUPLICATION AUDIT

### Exact file duplication

- **Exact duplicate groups before cleanup:** 6 groups / 12 files.
- **Exact duplicate groups after cleanup:** **0**.

The duplicate groups were backup copies of active files, plus a redundant final audit-report alias; they were removed instead of being merged into runtime implementations.

### Implementation duplication

The rate-limit subsystem is already consolidated around `api/middleware/rate-limit.middleware.js`; route modules consume limiter instances through `deps` rather than creating independent copies.

The inspected token/auth/provider helpers have a clear canonical runtime source and were not duplicated during this audit.

## 10. ENVIRONMENT / CONFIGURATION

### Required server-side configuration

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
PROVIDER_BASE_URL
PROVIDER_API_KEY
PROVIDER_TOKEN_ENCRYPTION_KEY (required for encrypted provider-token storage paths)
```

Additional optional/operational variables include provider paths/limits, email verification settings, `CRON_SECRET`, `OWNER_WHATSAPP_URL`, `TOKEN_CENTER_URL`, and `ECOSYSTEM_HANDOFF_SECRET`.

No hardcoded secret value was found in source during the secret-pattern scan.

`.env.example` contains placeholders only; secret values are not included in this archive.

## 11. SECURITY AUDIT

### Confirmed protections in code

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- strict referrer policy
- restrictive permissions policy
- HSTS when production is running over HTTPS
- JSON body limit
- per-user and endpoint-specific rate limits
- server-side owner authorization
- member status enforcement for suspended/banned accounts
- portal token format validation
- atomic token redemption via row locking and conditional assignment
- provider-token encryption at rest
- provider diagnostic payload sanitization
- secret comparison via timing-safe comparison
- server-only service-role usage
- no provider ID token returned to browser in the activation flow

### Security issues not changed due regression risk

The browser stores its Supabase access/refresh session in `localStorage`. This is a known XSS blast-radius tradeoff. Migrating to an HttpOnly cookie architecture would be a significant authentication redesign and was intentionally not performed under the user's "preserve valid behavior" rule.

## 12. DEPENDENCY AUDIT

Current manifest is internally consistent:

- Node `>=22`
- `express` `5.2.1`
- `express-rate-limit` `7.5.1`
- `@supabase/supabase-js` `2.112.3`
- `dotenv` `16.6.1`
- `package-lock.json` matches the manifest versions

A fresh dependency install was attempted in the sandbox but timed out. The partial install was removed so no generated `node_modules` tree enters the final archive.

### Current external package check

As of the web check on 2026-09-10:

- Express `5.2.1` is still the npm `latest` tag. 
- `@supabase/supabase-js` has newer releases (current npm page showed `2.116.0`), so the project is not at the newest SDK minor. This is treated as a **maintenance opportunity**, not a correctness fix, because upgrading it is unnecessary for the verified cleanup and introduces compatibility surface. citeturn895956search1turn895956search7
- The currently disclosed `express-rate-limit` CVE-2026-30827 affects versions `8.0.0` through `8.2.1`; the project is pinned to `7.5.1`, so that specific advisory does **not** identify the project's current version as affected. Patched 8.x releases include `8.0.2`, `8.1.1`, `8.2.2`, and `8.3.0`. citeturn509321search0turn509321search2

## 13. TEST / REGRESSION VERIFICATION

### Full project test command

```text
npm test
```

**Result: PASS**

All configured test groups completed successfully, including:

- provider contract
- provider diagnostic contract
- final magic-link flow
- quota/idempotency flow
- browser regression contracts
- provider delivery webhook
- signup OTP
- site URL
- owner portal access
- runtime contracts
- owner UI contracts
- app-release contracts
- member status enforcement
- single-entry SPA contracts
- portal-token contracts
- cleanup contracts
- maintenance refresh contracts
- owner button visibility
- canonical rate-limit contracts

### Additional verification

- all `.js` / `.mjs` files passed `node --check`
- `scripts/verify-runtime.mjs` → **PASS**
- `scripts/verify-architecture.mjs` → **PASS**
- exact duplicate scan after cleanup → **0 groups**
- backup-pattern scan under `public/` → **0 offenders**

## 14. CHANGES MADE

| File | Change | Reason | Risk | Verification |
|---|---|---|---|---|
| `server.js` | Removed obsolete `GET /app-intro.html` registration | Route pointed to a non-existent page and conflicted with the single-entry architecture | Low | Cleanup test + full `npm test` |
| 18 `public/*backup*` files | Removed rollback/backup artifacts | No active refs; publicly servable static files; duplicated historical implementations | Low | Reference scan + duplicate scan + cleanup test |
| `test/cleanup-contract.test.mjs` | Added regression guards for backup artifacts and `/app-intro.html` | Prevent recurrence of verified cleanup defects | Very low | Full `npm test` |
| `docs/migration/MIGRATION_SYNC_MANIFEST.json` | Corrected source migration count/history note to 46 | Metadata was stale versus actual directory contents | None | JSON parse + source inventory |
| `docs/migration/MIGRATION_PRODUCTION_BASELINE.json` | Corrected source migration file count to 46 | Metadata consistency | None | JSON parse + source inventory |
| `docs/REMOVED_FILES.txt` | Recorded all 18 removed artifacts | Keep cleanup register synchronized | None | Cleanup contract |
| `docs/reports/FULL_PROJECT_AUDIT_2026-09-10.md` | Rewritten as canonical current audit | Previous report did not match this archive's 251-file baseline | None | Manual consistency review |

## 15. REMAINING ISSUES

### CONFIRMED ISSUE

No additional confirmed source-level breakage was found after the cleanup pass.

### POSSIBLE ISSUE / MAINTENANCE

`@supabase/supabase-js` is pinned below the current npm latest. Upgrading should be handled as a separate dependency-maintenance change with a full runtime/regression pass rather than bundled into a stability cleanup. citeturn895956search7

### REQUIRES EXTERNAL VERIFICATION

1. Fresh `npm ci` / runtime import test in a networked environment.
2. Real Vercel deployment smoke test (`/`, `/api/health`, auth flow, Owner flow, release endpoints).
3. Real Supabase verification of migration history versus current live schema.
4. Real provider send → mailbox → verify → premium activation flow with production secrets.
5. Browser/device regression on the installed PWA shell.

## 16. FINAL AUDIT CONCLUSION

The uploaded source tree is now materially cleaner and more internally consistent without rewriting valid application logic.

The highest-confidence cleanup actions were deliberately narrow:

```text
verified backup artifacts
        ↓
remove
        ↓
verified orphan legacy route
        ↓
remove
        ↓
regression guards
        ↓
run complete test suite
        ↓
static architecture/reference re-audit
        ↓
PASS
```

No claim is made that production is fully verified until the external Supabase/provider/Vercel checks above are run in a real configured environment.
