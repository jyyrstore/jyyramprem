# Portal Token 12-Character Contract Fix — 2026-09-10

## Scope

This patch aligns the repository UI/documentation contract with the existing executable portal-token implementation:

- Canonical format: `JYYR` + 8 uppercase hexadecimal characters.
- Total length: 12 characters.
- Generator: `crypto.randomBytes(4)` followed by uppercase hexadecimal encoding.
- Validators: `^JYYR[A-F0-9]{8}$`.

## Changes

- Corrected the generator comment in `lib/runtime/app-runtime.js`.
- Corrected the legacy 20-character display comment in `public/js/owner/portal-token.js`.
- Changed the portal-token input to `maxlength=12` with a canonical placeholder in `public/index.html`.
- Added an Owner UI regression assertion for the 12-character input contract.
- Updated current portal-token documentation in `docs/README.md` and `docs/CHANGELOG_NAVIGATION.md`.
- Updated the current full-audit report wording so historical 20-character references are explicitly described as baseline history rather than the current contract.

## Verification

- `node scripts/verify-architecture.mjs` — PASS
- `node scripts/verify-runtime.mjs` — PASS
- `npm test` — PASS
- Portal-token contract tests — PASS (16/16)
- Owner UI contract tests — PASS (6/6)

## Security Note

The 12-character format uses 32 bits of random entropy. The existing unique token-hash constraint, redemption expiry, atomic claim semantics, single-use state transition, and rate limiting remain important controls.

## Not Changed

No migration was rewritten, no uncertain dead file was deleted, and no unverified live/production state was modified by this ZIP-only corrective patch.

## Production response hardening

- The Owner generate response now carries `tokenFormat: "JYYRXXXXXXXX"` and `tokenLength: 12` so the browser can distinguish the current response contract from an older deployment.
- The backend validates the exact plaintext token immediately before returning it and validates decrypted history tokens before exposing them to the Owner UI.
- The Owner portal scripts use a versioned query string so a stale deployed browser asset cannot silently reuse the previous token-contract consumer.
- The Owner inventory continues to prefer the full canonical token when encrypted storage is available; masked preview is only a legacy fallback when the plaintext cannot be safely recovered.
