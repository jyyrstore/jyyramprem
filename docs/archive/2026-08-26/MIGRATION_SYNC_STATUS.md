# Migration Sync Status

## Production truth

The connected production database was inspected directly on 21-08-2026.

- PostgreSQL 17.6 is reachable.
- Owner lock is present and claimed.
- Required Owner/Member tables exist with RLS enabled.
- All 37 RPC names used by the current server contract exist in production.
- Privileged RPCs are restricted to `service_role`.

## Repository truth

The repository does **not** contain the original 24 historical SQL bodies byte-for-byte. That historical archive cannot be honestly reconstructed from the available migration-history metadata.

Instead, this package now contains a clean rebuild path for the current application contract:

1. `20260818000000_create_am_account_portal_runtime_base_v1.sql` — runtime base tables.
2. Existing security/quota migrations.
3. `20260821040000_owner_runtime_contract_v1.sql` — Owner/Member runtime schema + RPC contract.
4. `20260821050000_production_parity_v1.sql` — production parity for verified constraints, indexes, and timestamp triggers.

The rebuild migrations are idempotent where practical and are intended for a clean database or controlled migration reconciliation. The parity patch now covers the production-only constraints, indexes, and timestamp triggers identified by direct catalog comparison. They are **not** claimed to be byte-for-byte copies of missing historical migrations.

## Safety

Do not apply old quarantined migration fragments from previous ZIPs. They were removed from this production package because they were incomplete/non-matching historical fragments.

## Pending 2026-08-23 change

`20260823223000_magic_link_delivery_quota.sql` adds the canonical user quota consumed on fresh magic-link delivery. It is **not claimed as applied to production** in this package. Apply it through the normal Supabase migration process, then verify the table and RPC exist before production rollout.
