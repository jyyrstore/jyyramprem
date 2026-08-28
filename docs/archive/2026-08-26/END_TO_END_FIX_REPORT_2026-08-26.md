# End-to-End Magic Link Fix — 2026-08-26

## Root cause
The previous implementation treated HTTP 200 + `success:true` from `/api/v1/send-magiclink` as delivery success. That is only provider acceptance. There was no durable delivery state and no way to distinguish provider acceptance from actual inbox delivery.

## Changes
- Added explicit `magic_link_delivery_status` state: `not_requested`, `provider_accepted`, `delivery_confirmed`, `delivery_failed`.
- Added opaque `magic_link_code_order` correlation field. It is never treated as a token.
- Added `magic_link_delivery_confirmed_at` and `magic_link_last_error`.
- `/api/generate` no longer tells the user that delivery is confirmed.
- Added rate-limited `/api/accounts/:id/send-magiclink` resend endpoint.
- Added authenticated `/api/accounts/:id/magiclink-status` endpoint.
- Added optional authenticated provider delivery webhook `/api/internal/provider/magiclink-delivery`. The webhook can confirm delivery if the provider supports delivery callbacks.
- Added frontend delivery-state polling for up to five minutes and a resend action.
- Preserved manual user-provided magic-link verification.
- Preserved server-only provider key and encrypted ID-token storage.
- `codeOrder` is stored only as an opaque provider correlation reference.

## Important boundary
If the provider only exposes `200 + success:true` and has no delivery callback/status API, the portal cannot truthfully prove inbox delivery. The new state machine deliberately reports `provider_accepted`, not `delivery_confirmed`, in that situation.

## Live database
The matching production migration was applied to the connected Supabase project and verified through `information_schema`. Privileged RPC execution remains restricted to `service_role`.

## Validation
- `node --check server.js` PASS
- `node --check public/js/home.js` PASS
- `npm test` PASS
- provider contract: 8/8
- provider diagnostic: 8/8
- flow: 9/9
- regression: PASS
- runtime verifier: PASS
- API routes: 48
- RPC references: 40

## Additional live-contract fix — provider verify response shape

The live `/api/v1/verify-account` response observed on 2026-08-26 places the verification flag at `profile.user.emailVerified` and the provider ID token at `profile.idToken`. The previous server extractor checked `profile.emailVerified` but not `profile.user.emailVerified`, which could incorrectly classify a successful provider response as `VERIFICATION_STATUS_MISSING`.

The runtime extractor now accepts `profile.user.emailVerified` (plus equivalent nested user/account/result shapes) while keeping the existing JWT claim checks (`email`, `email_verified`, and `exp`) as the authoritative local safety gate before Premium activation.


## 2026-08-26 final continuation fix

- If `/api/v1/send-magiclink` returns a valid magic-link URL, the authenticated browser receives that URL only in the immediate response; the portal does not persist it in Supabase.
- The frontend now automatically executes `verify-email -> apply-premium` when that returned URL exists.
- The portal uses only the mailbox/user-input bridge. Pasting the fresh link into the portal executes verification and Premium activation as one continuation instead of requiring a second activation click.
- No mailbox integration, disposable-mailbox creation, credential harvesting, or third-party inbox automation was added. The user must provide an email inbox they are authorized to access.
