# Deep Repository Audit — Project Alight Motion V4.2
Date: 2026-08-27

## Scope
Audited the complete supplied ZIP snapshot from filesystem root through frontend, backend, library modules, tests, scripts, Supabase migrations, static assets, and repository documentation. The audit was static/local; no production data or live Supabase schema was modified.

## Repository inventory
- Original archive: 166 ZIP entries
- Extracted original files: 148
- Cleaned files: 147
- Folders: 17
- Frontend JS: 12
- CSS: 8
- HTML pages retained: 7
- Supabase migrations: 18
- Fonts: 3
- Image assets: 48
- Tests: 10 test/regression source files

## Runtime architecture
### Backend
`server.js` is the central Express runtime. It exposes:
- 48 unique route paths
- 49 API route handlers
- 37 unique API paths
- `/api/config` for public Supabase client configuration
- authenticated user/member flows through Supabase Auth bearer tokens
- Owner authorization through the `is_owner` RPC
- provider diagnostic/delivery webhook boundaries
- generation, usage/quota, magic-link verification and premium activation endpoints
- Owner member/broadcast/message/FAQ/help/maintenance/statistics/health endpoints

### Frontend
Pages and their canonical scripts:
- `login.html` -> `auth-client.js`, `auth.js`
- `home.html` -> `home.js`, `nav.js`
- `dashboard.html` -> `dashboard.js`, `nav.js`
- `setting.html` -> `setting.js`, `nav.js`
- `owner.html` -> `owner.js`, `nav.js`
- `reset-password.html` -> `reset-password.js`
- shared notification, icon and UI-protection layers are loaded where needed
- `index.html` is a minimal session bootstrap and redirects to login/home

### Supabase
All 40 RPC names referenced by `server.js` have matching function definitions in the supplied migration snapshot. The migration manifest explicitly warns that the snapshot is not a byte-for-byte reconstruction of historical production migrations, so live production parity still needs deployment-time verification.

## Reference/connectivity audit
Verified:
- HTML CSS/JS references resolve locally after stripping URL query/hash components.
- Frontend API calls map to server routes, including dynamic account routes:
  - `/api/accounts/:id/send-magiclink`
  - `/api/accounts/:id/verify-email`
  - `/api/accounts/:id/magiclink-status`
  - `/api/accounts/:id/apply-premium`
- No second `home*.js` implementation remains; canonical source is `public/js/home.js`.
- No duplicate-byte files were found by SHA-256 in the cleaned tree.
- `login.html.bak` was identified as a stale backup artifact and removed.

## Login-page defects found and fixed
1. `scripts/verify-runtime.mjs` treated `/js/auth.js?v=20260827` as a literal filesystem path. This made the project's own verifier report a false broken-reference error. The verifier now strips query/hash portions before filesystem lookup.
2. `public/css/login.css` contained an orphan `filter:` declaration and unmatched closing brace immediately after `@keyframes charIn`. The filter was moved into the intended `.brand-char` rule.
3. The custom login heading used an overly tight `line-height: 0.95`; this was relaxed to `1.12` to accommodate the actual Belix font metrics.
4. The custom button font used `line-height: 1` with `overflow: hidden`, a combination capable of clipping glyph ascenders/descenders. Button line-height was raised to `1.12` and overflow was changed to visible so the font is not cropped.
5. The hidden `#loginTab` control was dead UI: it could not be focused or meaningfully used, yet the script updated it. It was removed from HTML and its JS/CSS references were removed.
6. `#authStatus` was a dead container: status messages are rendered by the global notification layer and the element was never populated. It was removed along with its dedicated CSS.
7. The login-mode label was corrected to `Email / Gmail` rather than implying username login support that the auth client does not implement.
8. An ineffective `submitButton.textContent = "Verifikasi Email"` assignment was removed; `buttonLoading()` restores the original button markup in `finally`, so that assignment could never persist.
9. `home.css` referenced `../assets/font/...` while the real directory is `Font/`. On case-sensitive filesystems that reference was broken; it was corrected.

## Other cleanup performed
- Removed the unused `redactProviderDiagnostic()` wrapper from `server.js`; the underlying sanitizer remains used.
- Removed the unused `pageName()` helper from `public/js/nav.js`.
- Kept route methods sharing the same path (GET/POST/PATCH/DELETE) because these are legitimate distinct handlers, not duplicate routes.
- Kept SQL helper/trigger functions that do not appear as direct `.rpc()` calls because several are used indirectly by triggers, other functions, or database behavior; deleting them would be unsafe without live-schema proof.

## Validation
Final `npm test` result:
- provider contract tests: 11/11 passed
- provider diagnostic tests: 9/9 passed
- flow/regression Node tests: 20/20 passed
- target user-email regression: PASS
- runtime verifier: PASS
- overall: PASS / exit code 0
- Node syntax checks: all checked JS/MJS files passed

## Important limitation
The supplied ZIP cannot prove current production reachability or live Supabase/provider state. No production credentials were used or changed during this audit. The cleaned snapshot is locally consistent and test-passing, but deployment should still run live health, provider, and Supabase verification with real secrets.

## Changed files
- `public/html/login.html`
- `public/css/login.css`
- `public/js/auth.js`
- `public/css/home.css`
- `public/js/nav.js`
- `server.js`
- `scripts/verify-runtime.mjs`
- `VERIFICATION_REPORT.json`
- removed `public/html/login.html.bak`
