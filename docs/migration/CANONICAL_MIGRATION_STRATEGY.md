# Canonical Supabase Migration Strategy

**Status:** ACTIVE
**Project:** Jyy'R Amprem
**Supabase project ref:** `jfjbdenqepaagxfysaar`
**Verified:** 2026-09-18

## 1. Canonical source of truth

There are two different truths and they must never be conflated:

1. **Production database state + production migration ledger** are the source of truth for what has actually been deployed to Supabase.
2. **`supabase/migrations/`** is the repository source of truth for migration SQL that developers intend to maintain going forward.

The repository is **not** a byte-for-byte historical copy of the production migration ledger. This is intentional and must be documented, not silently normalized.

## 2.1 Forward hardening applied 2026-09-18

The live project was verified before and after a focused privilege-hardening migration. The migration `20260917224004_harden_public_table_grants`:

- removed all direct `anon`/`authenticated` privileges from `public.am_email_verifications`;
- removed direct INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges from `public.app_releases`;
- retained SELECT for `anon`/`authenticated` on published releases, enforced by RLS.

The migration was applied through the connected Supabase project and its migration ledger now contains version `20260917224004`.

## 2. Current verified state

- Production migration ledger: **81 versions**.
- Latest production version: **`20260917224004_harden_public_table_grants`**.
- Repository migration files: **48**.
- Exact timestamp overlap: **9**.
- Production-only historical versions: **72**.
- Repository-only versions: **39**.
- Production contains repeated migration names from iterative repairs. Those are historical records and must not be deleted or renamed.

The repository also contains canonical/reconstructed migrations whose SQL represents the current runtime contract but whose timestamps are not present in the production ledger. Those files are **not safe to replay blindly** against production.

## 3. Non-negotiable rules for developers and agents

### Rule A — Never rewrite production history

Do not delete, rename, reorder, backdate, or manually edit rows in `supabase_migrations.schema_migrations` to make the ledgers look identical.

### Rule B — Never run an unreviewed production push from this snapshot

Until reconciliation is explicitly completed, **do not run `supabase db push` against production** from the repository migration directory.

A migration that is absent from the production ledger is not automatically safe to execute. The SQL may already be represented by later changes in the live schema.

### Rule C — Do not recreate missing historical SQL from memory

If production has a version that the repository does not contain, treat its SQL body as **historical-only** unless the original file/body can be recovered from a trusted source.

Never invent a replacement file with the old timestamp and assume it is equivalent.

### Rule D — New schema work starts from the reconciled canonical state

After reconciliation, the next migration must be:

```text
new unique timestamp
→ one focused schema change
→ test against canonical live state
→ apply to non-production / branch
→ verify
→ promote
```

Do not create new migrations by editing old migrations.

### Rule E — One logical change, one new migration

Do not amend an already-applied migration. Create a new migration that changes the current canonical state.

### Rule F — `CREATE OR REPLACE FUNCTION` history is not runtime duplication

Multiple historical migrations may define the same RPC/function. That is expected. Only the final live function definition is runtime truth.

## 4. Reconciliation workflow

Reconciliation is a controlled operation and must happen before automated deployment tooling is allowed to push migrations.

### Phase 1 — Freeze

No production migration push from the repository snapshot.

### Phase 2 — Inventory

Record:

- production migration versions + names
- repository migration filenames
- exact timestamp overlap
- source-only versions
- production-only versions
- current live tables, columns, functions, triggers, indexes, RLS policies

### Phase 3 — Classify each repository migration

Each repository migration must be classified as exactly one of:

- `historical-match` — exact production timestamp and intended historical SQL
- `already-represented` — its effect is already present in live schema through a different historical lineage
- `forward-pending` — genuinely changes the live canonical state and has not been applied
- `unknown` — effect cannot be proven safely

`unknown` blocks production deployment.

### Phase 4 — Establish the baseline

Create a reconciliation record that identifies the exact production ledger endpoint and the exact live schema state that the repository is baselined against.

Do not mark migrations `applied` merely because the schema looks similar. A migration-history repair is allowed only after the SQL effect has been reviewed and verified.

### Phase 5 — Forward-only operation

Once the baseline is reconciled:

```text
canonical baseline
      ↓
new migration
      ↓
local tests
      ↓
branch/staging verification
      ↓
production apply
      ↓
verify live schema
      ↓
record deployment
```

## 5. What the current repository means

The following files are considered **source lineage**, not historical proof of production execution:

- `supabase/migrations/20260818000000_create_am_account_portal_runtime_base_v1.sql`
- canonicalized owner/member runtime migrations
- canonical portal-token migrations from `20260904110000` onward
- ecosystem Token Center migrations
- `20260910040000_direct_redeem_owner_tokens_v1.sql`

Their presence proves source intent, not that the exact timestamp exists in the production ledger.

## 6. Production safety gate

A developer/agent must stop and report before production schema deployment when any of these are true:

- migration history is not reconciled
- a source migration timestamp is absent from production and the effect is not classified
- a source migration modifies an object already changed by a later live migration
- migration SQL was reconstructed rather than recovered
- live schema and repository assumptions disagree
- the target environment is not explicitly identified

## 7. Required commands/workflow

Safe inspection:

```bash
npm run verify:migrations
npm test
```

Production migration deployment is intentionally **not** part of `npm test` and must be an explicit, separately reviewed operation.

## 8. Current decision

**Do not attempt to make the 46 repository files numerically equal to the 80 production records.**

The correct target is:

```text
IMMUTABLE PRODUCTION HISTORY
          +
RECONCILED CANONICAL LIVE SCHEMA
          +
FORWARD-ONLY REPOSITORY MIGRATIONS
          =
ONE UNAMBIGUOUS DEPLOYMENT MODEL
```

This strategy prevents a developer or coding agent from mistaking a reconstructed/canonical migration file for an unapplied production migration.
