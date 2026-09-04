# Cleanup & UI Completion — 2026-08-27

## Completed

- Removed confirmed dead CSS candidates from `public/css/home.css` (`.step` reference in a dead mobile selector and `.action-hint`).
- Replaced the Owner page JavaScript with a consolidated runtime implementation to remove duplicated initialization/event paths and expose existing backend capabilities.
- Added Owner Member detail/profile editing, status filter, and real pagination.
- Added full FAQ CRUD UI including category, sort order, publish state, edit, and delete.
- Added full Help Center CRUD UI including category, sort order, publish state, edit, and delete.
- Added real Login Activity pagination.
- Added Broadcast Execute action for existing draft/scheduled broadcasts.
- Replaced static Owner security identity presentation with the authenticated Owner identity and server-verified authorization state.
- Reworked Owner health UI so it does not claim Storage/API-key health that the existing endpoint does not actually test.
- Added cache-control hardening: HTML/API/CSS/JS are not stored, while static media/fonts retain short-lived cache.
- Added `test/owner-ui-feature-contract.test.mjs` and included it in `npm test`.

## Supabase verification

The connected Supabase project `AM Account Portal` is active and healthy. Existing Owner/core RPCs are present and execute only through `service_role`; no database migration was changed in this cleanup pass because the requested work was UI/dead-code/cache cleanup and the live contracts were already present.

Supabase Security Advisor currently reports INFO-level `rls_enabled_no_policy` notices on several service-role-only tables/functions, plus a WARN that leaked-password protection is disabled. These are existing live-project posture items rather than consequences of the UI cleanup.

## Verification

- Node syntax checks: PASS
- Provider tests: 11/11 PASS
- Diagnostic tests: 9/9 PASS
- Flow tests: 20/20 PASS
- Runtime contract tests: 4/4 PASS
- Owner UI feature contract tests: 4/4 PASS
- Regression: PASS
- Runtime verifier: PASS
