# Portal Token Response Fix — 2026-09-10

## Problem reproduced from the supplied source

The current source already generates canonical tokens (`JYYR` + 8 uppercase hexadecimal characters), but the Owner frontend only trusted `response.token` and had no explicit response-contract marker. A stale/incompatible deployment can therefore insert a token successfully, then fail in the browser because the returned payload is masked, absent, or shaped differently.

This creates the observed split state:

- database insert succeeds;
- frontend receives a non-canonical/missing `data.token`;
- frontend raises the canonical 12-character validation error;
- inventory may still show the masked preview.

## Fixed behavior

### Generate endpoint

`/api/owner/token/generate` and `/api/owner/token/generate-batch` now:

- validate the exact plaintext token immediately before returning it;
- return `token` as the canonical plaintext value;
- return `tokenFormat: "JYYRXXXXXXXX"`;
- return `tokenLength: 12`.

### Owner history

The history endpoint validates decrypted `token_encrypted` values before exposing them to the Owner UI. A canonical plaintext token is displayed in full whenever encrypted storage is available. Masked preview remains only the fallback for legacy rows whose plaintext cannot be recovered.

### Frontend

The Owner generate consumer now accepts only an exact `JYYR[A-F0-9]{8}` token and can read the canonical token from the direct response or known nested batch shapes. It still fails closed for anything else, but the error explicitly identifies an outdated backend deployment.

Owner token scripts are also versioned with a query string to force a fresh browser asset after deployment.

## Canonical contract

```text
JYYRXXXXXXXX
```

Where `XXXXXXXX` is exactly eight uppercase hexadecimal characters (`0-9`, `A-F`).

Regex:

```text
^JYYR[A-F0-9]{8}$
```

Total length: **12 characters**.

## Verification

- `node --check api/routes/portal-token.routes.js` — PASS
- `node --check public/js/owner/portal-token.js` — PASS
- `node --check public/js/router.js` — PASS
- `npm test` — PASS (all bundled tests)
