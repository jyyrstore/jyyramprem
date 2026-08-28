# Audit Report — AMPREMJYYR TERBARU / Owner Authorization

## Scope

Audited the current AM Account Portal V4.1 ZIP, including `server.js`, Owner UI/auth client, public JavaScript, package metadata, Supabase migrations, Owner RPC wiring, RLS references, and secret exposure patterns.

## Production Supabase verification

Target project: `https://jfjbdenqepaagxfysaar.supabase.co`

Verified Owner UUID:
`925cf3c1-7423-4d48-9284-2964c426635f`

Database checks performed against the live project:

- `public.owner_lock` contains exactly the claimed Owner UUID for `id = true`.
- The UUID exists in `auth.users`.
- `public.is_owner('925cf3c1-7423-4d48-9284-2964c426635f')` returns `true`.
- `is_owner(uuid)` is `SECURITY DEFINER` and `STABLE`.
- `claim_initial_owner()` and `claim_initial_owner(uuid)` are `SECURITY DEFINER` and do not replace an existing owner.
- `require_owner()` is `SECURITY DEFINER` and delegates to `is_owner(auth.uid())`.
- Owner RPC execution is granted to `service_role`, not `anon`/`authenticated`.
- `owner_lock` has RLS enabled with canonical self-read policy `owner_lock_select_self`.
- `am_generated_accounts` and `am_api_usage` also have RLS enabled.

## Runtime wiring

### Owner status

`GET /api/owner/status`:

1. Requires a valid Supabase Bearer token through `requireAuth`.
2. Uses the authenticated user's UUID (`req.user.id`).
3. Calls the database `is_owner(uuid)` RPC through the server's service-role client.
4. Returns `owner: true|false` without exposing the service-role key.

`public/js/owner.js` calls this endpoint before rendering the Owner console. A non-owner is redirected to `/home.html`; an unauthenticated session is redirected to `/login.html`.

### Owner statistics

`GET /api/owner/statistics` requires both `requireAuth` and `requireOwner`. Statistics are calculated server-side from `am_generated_accounts`; the Owner UI no longer relies on the normal user-scoped `/api/accounts` endpoint for Owner-wide statistics.

### Owner health

`GET /api/owner/health` requires both `requireAuth` and `requireOwner`. The Owner UI calls this endpoint and only reports the Owner health state when the backend confirms `owner: true`.

### Logout

Both the profile logout button and the topbar logout button call `AMAuth.signOut()` and redirect to `/login.html`.

### Additional hardening in this build

If the Owner statistics/health endpoints unexpectedly return `401` or `403` after the initial Owner check, `owner.js` now immediately redirects to Login/Home instead of silently rendering stale or zero-valued Owner data.

## Static checks

- `node --check server.js`: PASS
- `node --check public/*.js`: PASS
- ZIP contains no `.env` file or hard-coded Supabase service-role credential.
- Service-role and provider keys are referenced only through environment variables/server code and `.env.example` placeholders.
- Owner status/statistics/health endpoints do not write to `owner_lock`.

## Intentionally not enabled

The following UI sections remain disabled because this project snapshot does not contain a complete database/API contract for them:

- Member management
- Broadcast send/history/edit/delete
- Member messaging
- FAQ CRUD
- Help Center CRUD
- Admin login activity
- Maintenance-mode write controls

No fake CRUD endpoints or arbitrary database writes were introduced.

## Migration note

The live database reports two applied migration versions carrying the name `owner_authorization_hardening_v1` (`20260820231708` and `20260820231710`). The live schema is currently correct, so migration history was not manually rewritten. Do not delete or edit rows in `supabase_migrations.schema_migrations` manually.

The ZIP migration `20260821000000_owner_authorization_hardening_v1.sql` is idempotent for an already-claimed `owner_lock` and does not insert a NULL owner.

## Expected runtime behavior

Without a token:

`GET /api/owner/status` -> `401 Login diperlukan.`

With a valid non-owner token:

`GET /api/owner/status` -> `200`, `owner:false`; Owner UI redirects to Home.

With the verified Owner token:

`GET /api/owner/status` -> `200`, `owner:true`.

Then:

`GET /api/owner/statistics` -> `200`, Owner statistics.

`GET /api/owner/health` -> `200`, `owner:true`, database connected.
