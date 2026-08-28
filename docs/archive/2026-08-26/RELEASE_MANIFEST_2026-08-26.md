# Release Manifest — V4.2 fixed

## Fix applied

Provider verify-account response parsing now supports the observed live shape:

`profile.user.emailVerified`

while retaining strict JWT validation and server-only encrypted token storage.

## Release exclusions

- `node_modules/`
- live `.env` / secrets
- transient logs/caches

## Validation

`npm test` — PASS

`node --check server.js` — PASS

All project JS/MJS syntax checks — PASS
