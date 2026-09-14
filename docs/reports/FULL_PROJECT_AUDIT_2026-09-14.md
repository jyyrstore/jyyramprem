# FULL PROJECT AUDIT — Jyy'R Amprem

Tanggal: 14 September 2026
Scope: repository archive `jyyramprem.zip`, live Supabase project `Jyy'R Amprem`, live Vercel project `jyyramprem`.

## 1. Executive Result

Project tidak dinyatakan `DONE` karena beberapa area membutuhkan verifikasi eksternal yang tidak aman untuk diasumsikan: install penuh di sandbox, browser/runtime lokal, parity source archive dengan remote GitHub, global distributed rate limiting, dan konfigurasi Auth leaked-password protection.

Perbaikan yang benar-benar didukung bukti telah diterapkan pada source archive:

1. Security headers diperkeras dengan CSP, COOP, nosniff, frame-ancestors, Referrer-Policy, Permissions-Policy.
2. Inline `onerror` pada profile image dihapus dan behavior dipertahankan dengan delegated error handler.
3. Batas APK source diselaraskan dengan bucket Supabase live: 100 MiB.
4. Logging error mentah di auth/owner/public/member routes diganti dengan structured safe logging.
5. Security-header regression contract ditambahkan dan dimasukkan ke `npm test`.

## 2. Project Statistics

| Metric | Result |
|---|---:|
| Files before | 239 |
| Folders before | 29 |
| Files after | 240 |
| Folders after | 28 |
| Files added | 1 |
| Files modified | 9 |
| Files removed | 0 |
| Production JS/MJS after | 89 |
| Test files after | 29 |
| SQL migration files | 46 |
| API route files | 7 |
| Asset files | 52 |
| Backup/temp/conflict files found | 0 |

No `.git` directory is present in the archive; Git state therefore cannot be honestly reported from this artifact.

## 3. Tests & Verification

| Area | Status | Evidence |
|---|---|---|
| Official `npm test` | PASS | exit 0 after fixes |
| Security header contract | PASS | 4/4 |
| Node syntax check | PASS | audited JS/MJS syntax clean |
| `npm ci` in sandbox | NOT VERIFIED | network/install timeout |
| Offline dependency install | NOT VERIFIED | cache missing package tarball (`wrappy`) |
| Local HTTP runtime | NOT VERIFIED | complete dependency install unavailable |
| Browser responsive/accessibility runtime | NOT VERIFIED | browser automation binary unavailable |
| Dependency CVE registry audit | NOT VERIFIED | external registry unavailable |
| Live Vercel production errors, last 24h | PASS | no warning/error logs found |
| Live Vercel production deployment | PASS | latest production deployment READY |
| Live Supabase DB connectivity | PASS | project ACTIVE_HEALTHY; SQL queries successful |

## 4. Architecture

The application is an Express 5 server deployed to Vercel, with `api/index.js` exporting the composition root from `server.js`. The source follows a route → middleware → runtime/service → Supabase pattern, with server-only access to elevated Supabase credentials.

`lib/runtime/app-runtime.js` is the largest cohesive module (about 1295 lines). It contains related runtime/business orchestration and is not split solely by line count because doing so would introduce unnecessary abstraction and coupling risk.

Canonical SPA views identified statically: `login`, `home`, `dashboard`, `setting`, `owner`, `app`, `help`, `maintenance`, `reset-password`.

## 5. API / Routing Audit

Canonical route families were traced in `server.js` and route modules. Auth-protected owner/member mutations consistently pass authentication + owner/member middleware + rate limiting as applicable. Public app/help/FAQ/maintenance routes are intentionally public. Internal provider/maintenance routes are server-side endpoints and should remain protected by their deployment/network contract.

The route facade contains multiple compatibility/static-page aliases (`/login`, `/login.html`, `/home.html`, etc.) that are intentionally handled by the SPA router; these are not treated as obsolete without runtime proof.

## 6. Frontend ↔ Backend Contract

Static trace confirms UI modules call the expected API families for auth, access, accounts, usage, owner management, messaging, broadcasts, FAQ/help, notifications, token center, app releases, and maintenance. Input validation is present at route boundaries and resource IDs are UUID-validated where required.

No confirmed request-field name mismatch or response-field mismatch was found by static contract tests. Full live browser contract remains NOT VERIFIED.

## 7. Supabase / Database Audit

Live project: `Jyy'R Amprem`, ref `jfjbdenqepaagxfysaar`, PostgreSQL 17, region `ap-southeast-2`, status `ACTIVE_HEALTHY`.

### RLS

All application tables inspected in `public` have RLS enabled. Many server-only tables intentionally have no `anon`/`authenticated` policies and are only operated through server-side RPCs/service-role access. This is not treated as a vulnerability; adding broad policies would weaken the architecture.

### RPC / SECURITY DEFINER

Application RPCs are EXECUTE-granted to `service_role`/postgres, not `anon` or `authenticated`. Security-definer functions were inspected for hardened `search_path`; the majority use `SET search_path TO ''`, while trusted internal functions use explicit `public, pg_temp` where needed.

The live token verification function performs owner exclusion, suspended/banned checks, row locking, conditional single-user assignment, grant issuance, and request fulfilment. This matches the direct-redeem design reflected in the repository.

### Live security advisor

Confirmed live finding: `auth_leaked_password_protection` is disabled. This is a Supabase Auth configuration finding rather than a source-code defect. Supabase documentation states leaked-password protection is configured in Auth settings and is available on Pro plan and above.

Status: **NOT VERIFIED / EXTERNAL CONFIGURATION REQUIRED**.

### Storage

Live `app-releases` bucket: public, max file size 100 MiB, APK/octet-stream MIME types. Source was aligned from 512 MiB to 100 MiB to prevent source/runtime contract drift.

## 8. Migration Lineage

The repository contains 46 migration files, including migrations dated after the live migration ledger's latest recorded migration (`20260904122452`). The live database behavior already reflects some later logical changes, so the ledger difference is not proof that a particular effect is absent.

Repository migration reconciliation documents explicitly require reconciliation before production push and prohibit rewriting/applied-migration edits. Therefore no live migration was pushed during this audit.

Status: **NOT VERIFIED / RECONCILIATION REQUIRED BEFORE ANY DB PUSH**.

## 9. Environment / Secrets

Static source review found server-only elevated Supabase credentials and no service-role reference in `public/`. Environment parsing rejects placeholder secrets. No confirmed hardcoded production secret was found.

Client-side exposure of public/publishable Supabase configuration is acceptable; elevated credentials must remain server-only.

## 10. Authentication / Authorization

The current middleware flow validates authenticated requests with Supabase server-side `auth.getUser`, derives owner state independently, and applies member suspension/ban and portal-access checks. Owner middleware rechecks owner authority.

No confirmed IDOR/BOLA path was found in the audited owner/member resource handlers. RPCs also repeat ownership checks where privileged operations are exposed.

## 11. Injection / Security Categories

| Category | Status |
|---|---|
| SQL Injection | NO CONFIRMED ISSUE |
| NoSQL Injection | NOT APPLICABLE |
| Command Injection | NO CONFIRMED ISSUE |
| XSS | NO CONFIRMED ISSUE; runtime browser verification NOT VERIFIED |
| SSRF | NO CONFIRMED ISSUE |
| IDOR/BOLA | NO CONFIRMED ISSUE |
| Auth Bypass | NO CONFIRMED ISSUE |
| Privilege Escalation | NO CONFIRMED ISSUE |
| Hardcoded Secret | NO CONFIRMED ISSUE |
| Client-side Secret | NO CONFIRMED ISSUE |
| CORS | NO CONFIRMED ISSUE |
| CSRF | NO CONFIRMED ISSUE for bearer-auth API model |
| Cookie Security | NOT APPLICABLE to primary bearer-token client flow |
| Security Headers | PASS in source; deployed verification NOT VERIFIED |
| Sensitive Logging | FIXED in source; deployed verification NOT VERIFIED |
| Rate Limiting | NOT VERIFIED for global distributed guarantee |
| Brute Force | PARTIAL/PASS at endpoint layer; global distributed effectiveness NOT VERIFIED |

## 12. Confirmed Findings / Repairs

### HIGH — Supabase Auth leaked password protection disabled

- Category: Authentication configuration
- Evidence: Live Supabase Security Advisor reports `auth_leaked_password_protection` disabled.
- Root cause: Auth project setting not enabled.
- Impact: known compromised passwords are not rejected by Supabase Auth.
- Fix: Requires Supabase Auth settings/plan-level configuration; no safe code-only substitute was applied.
- Verification: Current setting remains disabled.
- Status: NOT VERIFIED / EXTERNAL CONFIGURATION REQUIRED.

### HIGH — Production migration lineage divergence

- Category: Database/DevOps
- Evidence: live migration ledger latest is `20260904122452`; repository contains later migrations through `20260910040000`; repo reconciliation documents prohibit blind production push.
- Root cause: repository and production migration histories have diverged.
- Impact: blind `db push` could replay/conflict with already-applied logical changes or produce schema drift.
- Fix: keep production immutable until reconciliation is completed; do not rewrite history.
- Verification: repo/live lineage remains divergent; safe push not verified.

### MEDIUM — Missing CSP/COOP/security headers in source

- Root cause: header set did not include CSP/COOP and related browser-hardening directives.
- Fix: `lib/config/security.config.js` hardened; dynamic Supabase origin included; no `unsafe-inline` in script policy.
- Verification: `test/security-headers-contract.test.mjs` PASS 4/4 and `npm test` PASS.

### MEDIUM — App release size contract mismatch

- Evidence: live storage bucket max 100 MiB while source constant was 512 MiB.
- Root cause: source validation allowed files the live storage layer would reject.
- Fix: `lib/config/app.config.js` now uses 100 MiB.
- Verification: contract test PASS.

### MEDIUM — Sensitive raw error logging

- Evidence: historical Vercel log for usage endpoint contained the full Cloudflare 522 HTML response, including an IP address; several route files also logged raw error objects.
- Root cause: `console.error(..., error)` leaked provider/database response content into logs.
- Fix: auth/owner/public/member route logging now serializes only safe error code/message fields.
- Verification: security-header contract scans audited server source and `npm test` PASS.

## 13. Historical Vercel Errors

Older deployments recorded errors such as `crypto.randomBytes is not a function`, `ensureMemberProfile is not a function`, token history decrypt errors, and Supabase gateway timeouts. These correspond to earlier deployments; the latest production deployment is READY and the last-24h production warning/error query returned no logs.

These historical errors are therefore not treated as current confirmed runtime failures.

## 14. UI/UX Audit

The application already uses a custom premium dark-purple product direction rather than a generic admin template. No broad redesign was performed.

Primary actions and route flows are present. The static UI audit found labels/ARIA on inputs and icon-only controls, `aria-live` status surfaces, modal focus handling, and 44px-class button/touch targets in the final UI layer.

Known architectural note: duplicate IDs exist across inactive SPA views (e.g. repeated navigation/control IDs). The router removes inactive views from the active DOM. Removing/renaming these IDs without a full runtime regression would be broad-risk, so they were kept.

### Screen inventory

| Screen | Primary action | Status/state coverage |
|---|---|---|
| Login | Masuk / Google | loading/error/validation present |
| Home | Generate / verify | loading/error/access gate present |
| Dashboard | Refresh / inspect | empty/loading/error patterns present |
| Setting | Save / account action | modal/status patterns present |
| Owner | Manage selected owner function | auth/owner gating present |
| App Center | Download latest app | release/empty/error paths present |
| Help | Read/search help content | empty/error patterns present |
| Maintenance | Recheck status | public maintenance response present |
| Reset Password | Save new password | validation/status present |

## 15. Icon Audit

A centralized icon mapping exists in `public/js/icons.js`, with local semantic assets in `public/Icon`. Core operational controls do not rely on emoji as their primary icon language. No icon dependency was added merely for cleanup.

| Screen | Element | Current icon | Decision | New icon | Reason |
|---|---|---|---|---|---|
| Login | Password visibility | eye asset | KEEP | same | semantic and familiar |
| Navigation | Home | Home asset | KEEP | same | semantic |
| Navigation | Settings | setting asset | KEEP | same | semantic |
| Owner | Search member | cari asset | KEEP | same | semantic |
| Owner | Edit | edit-profil asset | KEEP | same | semantic |
| Owner | Delete | cancel/trash-style asset | KEEP | same | destructive meaning retained |
| Owner | Refresh | Refresh asset | KEEP | same | standard action |
| Owner | Security | scurity asset | KEEP | same | security context |
| App | Download | Download-App asset | KEEP | same | standard action |
| Generic | Success | ceklis asset | KEEP | same | state acknowledgement |

No bulk icon replacement was made because there was no evidence-based consistency failure requiring it.

## 16. Broken Connections

No confirmed broken source-level dependency remained after the current fixes.

Potentially sensitive boundaries remain external-verification items:

1. Repository archive ↔ remote GitHub parity: NOT VERIFIED.
2. Repository migrations ↔ production migration ledger: NOT VERIFIED / reconcile required.
3. Source security headers ↔ deployed Vercel headers: NOT VERIFIED.
4. Global rate limit ↔ distributed serverless state: NOT VERIFIED.
5. Local source ↔ real browser runtime: NOT VERIFIED.

## 17. Changes Made

1. `lib/config/security.config.js` — browser security headers hardened. Risk: low; behavior impact: header-level browser hardening only.
2. `public/index.html` — inline image error handler removed. Risk: low; behavior preserved via router event delegation.
3. `public/js/router.js` — delegated image error handler added. Risk: low.
4. `lib/config/app.config.js` — release max size aligned to live bucket. Risk: low; rejects >100 MiB consistently with storage.
5. `api/middleware/auth.middleware.js` — safe structured auth logs.
6. `api/middleware/owner.middleware.js` — safe structured owner logs.
7. `api/routes/public.routes.js` — safe public route error logs.
8. `api/routes/member.routes.js` — safe usage error logs.
9. `test/security-headers-contract.test.mjs` — regression coverage added.
10. `package.json` — security header test included in official `npm test`.

## 18. Git

`.git` is absent from the supplied archive, so current staged/unstaged state and commit history are NOT AVAILABLE.

Suggested atomic commit sequence after applying the archive to the real Git repository (do not execute blindly; first inspect `git status --short`):

```bash
git status --short
git diff -- lib/config/security.config.js public/index.html public/js/router.js lib/config/app.config.js api/middleware/auth.middleware.js api/middleware/owner.middleware.js api/routes/public.routes.js api/routes/member.routes.js test/security-headers-contract.test.mjs package.json
```

```bash
git add lib/config/security.config.js public/index.html public/js/router.js api/middleware/auth.middleware.js api/middleware/owner.middleware.js api/routes/public.routes.js api/routes/member.routes.js lib/config/app.config.js
git commit -m "fix(security): harden headers and safe error logs" -m "WHY: reduce browser attack surface and prevent raw upstream/database errors from reaching logs.\nWHAT: add CSP/COOP and related headers, replace raw error logging with safe structured fields, and preserve image error behavior without inline handlers.\nTRADEOFF: CSP permits inline styles but keeps scripts self-hosted; browser/runtime deployment parity still requires verification."
```

```bash
git add test/security-headers-contract.test.mjs package.json
git commit -m "test(security): cover header and logging hardening" -m "WHY: prevent regressions in security headers, release-size alignment, inline-handler removal, and log sanitization.\nWHAT: add contract coverage and run it as part of npm test.\nTRADEOFF: test suite is slightly longer but remains deterministic."
```

```bash
git status --short
git diff --check
git log --oneline -5
```

## 19. Remaining Issues

### CONFIRMED ISSUE

- Supabase Auth leaked-password protection is disabled in the live project.

### POSSIBLE / OPERATIONAL ISSUE

- Global rate limiting across Vercel serverless instances is not proven to be distributed. Endpoint-level limiters exist; no shared store guarantee was verified.
- Duplicate IDs across inactive SPA views remain a structural risk but no runtime breakage was proven.

### REQUIRES EXTERNAL VERIFICATION

- Supabase Auth settings update.
- Migration reconciliation and production push readiness.
- Full npm dependency install + registry vulnerability scan.
- Real browser/device responsive/accessibility verification.
- Vercel deployed response headers and HTTP smoke tests from a reachable client.
- Exact remote GitHub source parity.

## 20. Final Definition of Done

**NOT DONE** under the user's strict definition because the required areas above are not all externally verifiable. The repository changes themselves are tested and the live production deployment currently reports no new runtime warnings/errors in the last 24 hours, but unverified areas are intentionally not marked PASS.
