# FINAL AUDIT & REPAIR REPORT — 2026-09-04

## Scope

`jyyramprem.zip` in this task was the sole source-code baseline. The repository was inspected across Express/server routes, browser HTML/CSS/JS, authentication/session handling, Supabase migrations/RPCs/RLS, tests, verification SQL, and portal-token documentation. No previous ZIP was used as a code source.

## Final portal-token contract

The canonical model is:

**1 TOKEN = 1 USER.**

A newly generated Owner token is unassigned and available to any member for exactly 24 hours. The first successful redemption wins and atomically sets `assigned_user_id`, `used_at`, and `status='used'`. A later user is rejected. An unused token whose 24-hour redemption window expires becomes `expired` and is retained as history.

After redemption, access is independent of the redemption window:

- `15_days` → `access_expires_at = redemption time + 15 days`
- `30_days` → `access_expires_at = redemption time + 30 days`
- `permanent` → `access_expires_at = NULL`

A redeemed token never becomes available again, including after user access expires. Owner revoke invalidates an available token or immediately removes portal access for its assigned user. Accounts are never deleted because portal access expires.

## Repairs implemented

### Database / Supabase

Added `20260904150000_canonical_single_user_token_redemption_v7.sql`.

It adds canonical `redemption_expires_at` to tokens and canonical `access_expires_at` to grants; enforces valid status/duration values; adds indexes for redemption state, token assignment, and access expiry; normalizes historical rows; expires stale unused tokens; and creates canonical RPC behavior.

`owner_create_portal_token` now accepts only the duration mode and creates an unassigned token with a 24-hour redemption window.

`portal_verify_token(uuid,text)` uses `FOR UPDATE` on the token row and writes the assignment in the same transaction. This makes concurrent redemption first-wins: only one caller can successfully assign the token.

`portal_has_access(uuid)` authorizes only an active member whose current grant belongs to a `used` token assigned to that same user and whose `access_expires_at` is still valid or NULL.

`portal_get_token_lifetime(uuid)` resolves only the token assigned to the requested user. It no longer falls back to a global/newest token.

Owner revoke supports both available and already-assigned tokens. RLS remains enabled on portal token/grant/request tables, direct browser-role access is revoked, and privileged token RPC execution is restricted to `service_role`.

### Backend/API

`server.js` now treats the application-computed timestamp as the 24-hour redemption deadline only. The database calculates the authoritative deadline and access expiry during redemption.

The access API now exposes separate `redemptionExpiresAt` and `accessExpiresAt` fields. Owner generation no longer sends an expiry duration to the database. Token history distinguishes available, assigned, expired, and revoked states.

Owner access remains outside the member token gate.

### Authentication / session / access guard

The existing login flow continues to use email/password. After authentication, the server checks portal access. An active member assignment skips the token gate; logout does not delete the assignment.

A new portal-access watchdog is attached to `home`, `dashboard`, and `setting`. It checks the authoritative access endpoint at page load, every 30 seconds, and when a hidden tab becomes visible, receives `pageshow`, or regains focus. A denied/expired member is signed out and redirected to the token gate. Network/server failures do not falsely revoke a session.

Backend protected APIs remain authoritative, so client countdowns cannot grant access after expiry.

### Settings UI

The profile-card token section now displays the member's actual access lifetime, not the redemption window. Finite access is rendered as days/hours/minutes with an exact expiry timestamp; permanent access is shown as `PERMANENT`; expired/revoked access is clearly denied.

### Owner UI

Owner token history now distinguishes `AVAILABLE`, `ASSIGNED`, `EXPIRED`, and `REVOKED`. Available tokens show their redemption deadline. Assigned tokens show the user's access deadline. Generated-token messaging explicitly states the 24-hour redemption window and first-user lock.

### Tests / verification / docs

Stale tests that encoded global reusable tokens or fixed 24-hour member grants were replaced with assertions for the final contract. Production verification SQL now checks canonical columns, row locking, duration modes, assignment invariants, and expired-unused-token state.

`docs/PORTAL_TOKEN_LIFETIME_ACCESS_CONTRACT.md` now documents the final two-clock model.

## Historical data policy

Migration V7 does not delete portal-token history. Historical token rows with exactly one distinct redeemer can be associated with that user. Historical tokens that were demonstrably shared by multiple users cannot be converted into a truthful 1-token-1-user ownership model without inventing ownership, so they are revoked while their existing grant history remains preserved.

Legacy `expires_at` columns are retained only as compatibility mirrors during migration. Canonical runtime authorization uses `redemption_expires_at` and `access_expires_at`.

## Verification status

Static JavaScript syntax checks passed for the modified server, owner, settings, and access-watchdog files. The Node test suite is used as the repository-level regression gate.

A live production database execution was not performed from this ZIP-only audit environment; `supabase` CLI is not installed here and no live Supabase credential/configuration was supplied for this run. The included production verification SQL must be run against the actual Supabase project after deployment of V7.
