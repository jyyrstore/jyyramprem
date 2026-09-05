# JYY'R Two-Site Deployment Checklist

## Token Center — `jyy-r-token-am`

Set Production environment variables:

`AMPREM_URL=https://<LIVE-AMPREM-DOMAIN>`
`ECOSYSTEM_HANDOFF_SECRET=<same secret used by Amprem, >=32 chars>`
`TOKEN_LIST_LIMIT=20`
`AMPREM_TIMEOUT_MS=10000`

Deploy the fixed Token Center source.

Then verify:

- `/health` returns HTTP 200.
- `/api/runtime-config` returns JSON containing `ampremUrl`.
- `/api/tokens?limit=1&offset=0` reaches Amprem.
- Vercel logs no longer show `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.

## Amprem

Set Production environment variables:

`TOKEN_CENTER_URL=https://jyy-r-token-am.vercel.app`
`ECOSYSTEM_HANDOFF_SECRET=<exact same secret used by Token Center>`

The Amprem deployment must expose:

`GET /api/public/tokens`
`GET /api/public/tokens/:id`
`POST /api/ecosystem/handoff/inspect`
`POST /api/ecosystem/handoff/consume`
`POST /api/access/token-center-link`

## End-to-end smoke test

1. Login to Amprem as a valid member.
2. Open the token gate.
3. Press `GET TOKEN`.
4. Confirm Token Center opens with a `state` query parameter.
5. Confirm the session badge becomes authenticated.
6. Confirm published tokens load.
7. Select a token.
8. Confirm the one-time handoff is consumed.
9. Confirm redirect to Amprem `/login.html` with `mode=register`, `username`, and `token_id`.
10. Complete the existing registration/token flow.
