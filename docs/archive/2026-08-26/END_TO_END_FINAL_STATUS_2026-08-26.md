# End-to-End Final Status — 2026-08-26

## Final flow
1. `POST /api/v1/send-magiclink`
2. The user retrieves the fresh magic link manually from an inbox they control and pastes the URL into the portal.
3. `POST /api/v1/verify-account`
4. Provider verification response is parsed from `profile.user.emailVerified` and equivalent nested forms.
5. Provider `idToken` is validated against email/expiry and encrypted server-side.
6. `POST /api/v1/apply-premium`
7. Successful Premium activation updates the account and consumes member quota exactly once.

## Automatic continuation
- When Step 1 is acceptance-only, the UI keeps a fresh-link input. Submitting that link now runs verification and Premium activation as one continuation.
- Provider HTTP 200 is still treated as acceptance, not proof of inbox delivery.

## Security boundaries
- Provider API key stays server-side.
- Provider ID token is never returned to the frontend and is stored encrypted in Supabase.
- Magic links are not persisted in Supabase logs/account state.
- No mailbox integration, disposable-mailbox creation, credential harvesting, or third-party inbox account automation is included.

## Verification
- `npm test`: PASS
- Syntax checks for `server.js` and `public/js/home.js`: PASS
- Runtime verifier: PASS
- Added auto-chain regression contract tests: PASS

## Deployment limitation
A live end-to-end provider transaction was not executed from this build because the uploaded project contains only placeholder/redacted provider credentials. The code path is contract-tested, but a real production transaction still requires a valid server-side `PROVIDER_API_KEY` and the actual configured Supabase environment.


## Live regression hotfix — 2026-08-26

The live provider calls completed successfully, but the post-activation quota
recording raised PostgreSQL `42702: column reference "usage_date" is ambiguous`.
The cause was the `RETURNS TABLE (... usage_date ...)` output variable colliding
with the `ON CONFLICT (usage_date, user_id)` target in
`consume_magic_link_quota()`. The release migration now uses the named primary
key constraint `am_magic_link_quota_usage_pkey`, removing that ambiguity.

The browser verify->apply chain was also hardened: the visible Apply button is
disabled while automatic `apply-premium` is in flight, preventing a concurrent
second provider request caused by a user click during the automatic transition.
