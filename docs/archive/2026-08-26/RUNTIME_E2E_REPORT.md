# Runtime / E2E Reconciliation Report — 21-08-2026

## Result

The project has been reconciled at the source/configuration level and the connected Supabase production database has been checked directly.

### PASS

- Node syntax: `server.js` and all frontend JS pass `node --check`.
- Local frontend asset references: no missing `/css/*` or `/js/*` references.
- Stable HTML routes: `/`, `/login.html`, `/home.html`, `/dashboard.html`, `/setting.html`, `/owner.html`, `/reset-password.html` are explicitly mapped by `server.js` to `public/html/*`.
- `package.json` and `package-lock.json` are pinned to the same exact dependency versions.
- Supabase project `jfjbdenqepaagxfysaar` is reachable.
- Production Owner/Member tables exist and RLS is enabled.
- All 37 backend RPC names referenced by the current server contract exist in the connected Supabase database.
- Owner RPCs are `SECURITY DEFINER`, use a restricted search path, and are executable by `service_role` while `anon` and `authenticated` do not have execute permission.
- `is_owner()` rejects a random UUID.
- Public maintenance RPC returns a valid maintenance object.
- An Owner lock is present in the connected database.

## Dependency status

Pinned versions:

- `@supabase/supabase-js` 2.112.3
- `dotenv` 16.6.1
- `express` 5.2.1
- `express-rate-limit` 7.5.1

`node_modules/` is intentionally excluded from the package. Run `npm ci` on the target machine.

## Remaining deployment-only checks

These require the real deployment secrets and/or a real authenticated browser session and therefore are not fabricated here:

1. Login/Register against Supabase Auth.
2. Password recovery end-to-end.
3. `/api/generate` against the configured provider.
4. Browser Owner session with the real Owner account.
5. Live broadcast/message mutation using a real authenticated Owner.
6. Vercel production smoke test after environment variables are installed.

No private key is embedded in this package.
