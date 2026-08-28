# Live Supabase Idempotency + Provider Quota Audit

Project: `jfjbdenqepaagxfysaar`

## Production migration status

Applied migrations:
- `idempotency_and_provider_quota_v1`
- `harden_provider_quota_atomicity_v2`
- `fix_generation_idempotency_claim_v2`
- `fix_generation_idempotency_rowcount_v3`
- `fix_provider_quota_column_ambiguity_v3`

## Findings and fixes

1. The first idempotency claim implementation incorrectly used the `FOUND`
   state from the preceding `am_generated_accounts` insert. A duplicate key
   could therefore be reported as new. This was fixed by checking the row count
   of the idempotency insert itself and serializing the same key with an
   advisory transaction lock.
2. Provider quota reservation originally calculated `SUM(request_count)`
   without serializing concurrent reservations. It now locks the usage date,
   preventing concurrent requests from collectively exceeding the daily limit.
3. PL/pgSQL output-column names were ambiguous in the quota function. All table
   references are explicitly qualified.

## Live RPC black-box results

- First idempotency claim: PASS (`is_new=true`, state `pending`)
- Duplicate idempotency claim: PASS (`is_new=false`, same `account_id`)
- Provider quota reservation #1 with limit 2: PASS (`allowed=true`, total 1)
- Provider quota reservation #2 with limit 2: PASS (`allowed=true`, total 2)
- Provider quota reservation #3 with limit 2: PASS (`allowed=false`, total 2)
- `anon`/`authenticated` execute privilege on provider quota RPC: DENIED
- `service_role` execute privilege: GRANTED

All temporary audit rows were removed after testing.

## Local verification

The source-level local contract tests and existing provider/external mailbox provider tests pass.
A full local HTTP boot requires the project's dependency installation and local
Supabase credentials; those were not available in this execution environment,
so no claim is made that a real Termux process was started remotely.
