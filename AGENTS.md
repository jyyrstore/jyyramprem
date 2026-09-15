# AGENT INSTRUCTIONS — SUPABASE MIGRATION SAFETY

## Authentication provider policy

Google Login is an additive Supabase Auth provider. It does **not** require a database migration.

- Keep email/password registration and six-digit email verification unchanged.
- Google login must enter through the first-party `GET /api/auth/google` redirect route.
- The browser must not receive or store the Google Client Secret.
- Do not accept a caller-supplied OAuth `redirectTo`. Browser requests use the canonical `APP_URL`; the native Android request is selected only by the fixed `client=android` marker and always redirects to `jyyramprem://auth/callback`.
- Supabase/Google provider credentials are configured outside the repository in Google Auth Platform and Supabase Auth Provider settings.
- Do not add a migration solely to enable Google OAuth.

## Canonical migration policy

Read `docs/migration/CANONICAL_MIGRATION_STRATEGY.md` before changing anything under `supabase/`.

This project has **historically divergent production and repository migration lineages**.

### Production is immutable history

- Production migration ledger is historical evidence of what was actually applied.
- Never delete, rename, reorder, backdate, or manually rewrite production migration-history rows.
- Never edit an already-applied production migration to change its meaning.
- Never recreate missing historical SQL from memory.

### Repository migrations are not a historical mirror

- `supabase/migrations/` contains the repository's maintained migration source.
- A repository migration timestamp that is absent from production is **not automatically pending**.
- Its effect must be classified before any production deployment.

### Current production baseline

- Supabase project ref: `jfjbdenqepaagxfysaar`
- Production migration count: **80**
- Latest production migration: `20260904122452_remove_duplicate_app_release_timestamp_trigger`
- Repository migration count: **46**
- Exact timestamp overlap: **8**
- Production-only versions: **72**
- Repository-only versions: **38**

### Deployment gate

Until reconciliation is explicitly completed:

```text
DO NOT run `supabase db push` against production from this repository.
```

Also do not run migration-history repair commands automatically. A history repair is a deliberate deployment operation requiring proof that the corresponding SQL effect is already present in the target database.

### Required pre-change checks

```bash
npm run verify:migrations
npm test
```

### Required classification before production schema change

Every relevant repository migration must be classified as one of:

- `historical-match`
- `already-represented`
- `forward-pending`
- `unknown`

`unknown` blocks production deployment.

### Safe future workflow

```text
canonical live state
→ new unique migration
→ local verification
→ branch/staging verification
→ production apply
→ live schema verification
→ deployment record
```

When in doubt, stop the migration deployment and report the exact version, SQL effect, target project, and mismatch instead of guessing.
