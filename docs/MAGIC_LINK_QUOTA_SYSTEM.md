# Magic Link Delivery Quota

## Canonical behavior

The member quota is **not consumed when `/api/generate` creates an account**.

The quota is consumed exactly once for an account **after STEP 3 succeeds** (`POST /api/accounts/:id/apply-premium`).

The `POST /api/v1/send-magiclink` acceptance and STEP 2 verification do **not** consume member quota. This keeps quota accounting aligned with a completed Premium activation.

## Safety rules

- One generated account can consume at most one user-quota unit.
- The consumption is atomic and idempotent.
- Concurrent delivery paths cannot double-charge the same account.
- If the daily limit is already reached, the portal does not return the magic link.
- If quota storage is unavailable, the portal fails closed and does not return the magic link.
- The `auto-activate.magicLink` value is never used for quota delivery or returned to the frontend.
- Provider request safety budget remains independent from user quota.

## Data model

`am_magic_link_quota_usage`
- One row per user/day.
- `consumed_count` is the number of accounts whose fresh magic link was delivered that day.

`am_magic_link_deliveries`
- One row per generated account.
- Its primary key is `account_id`, making quota consumption idempotent per account.
- Stores only delivery metadata; no raw magic link is stored.

## Configuration

`MAGIC_LINK_DAILY_LIMIT=5`

`DAILY_LOCAL_LIMIT` is accepted only as a backward-compatible fallback for existing environments.

## Important deployment requirement

The migration
`20260823223000_magic_link_delivery_quota.sql`
must be applied to the target Supabase database before deploying the corresponding server build.

The source package has been verified locally, but production migration application was **not** claimed from this package alone.


## V2 boundary

The quota layer is independent of external mailbox provider credentials and independent of Alightfree. The portal consumes the user magic-link quota only after a confirmed successful Premium activation; the send request and verification are non-consuming stages.
