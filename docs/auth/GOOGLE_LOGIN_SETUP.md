# Google Login — Jyy'R Amprem

This project now supports Google OAuth as an additional **login method**. The existing email/password + email-code registration flow remains unchanged. No database migration is required for this feature.

## Runtime flow

Browser
→ `GET /api/auth/google`
→ Supabase Auth `signInWithOAuth({ provider: "google" })`
→ Google consent/login
→ Supabase callback
→ redirect to the canonical app URL with the implicit-flow session fragment
→ `public/js/auth-client.js` adopts and clears the access/refresh tokens
→ existing `continueAfterAuth()` / portal access gate

The server never receives or stores the browser session tokens from the URL fragment.

## Supabase configuration

In the Supabase project, enable **Authentication → Providers → Google** and enter the Google OAuth Client ID and Client Secret. These provider credentials belong in Supabase Auth configuration; do not put them in this repository, browser JavaScript, or `NEXT_PUBLIC_*` variables.

In **Authentication → URL Configuration**, add the exact canonical application URL used by `APP_URL`, for example:

```text
https://www.jyyramprem.my.id/
```

For local testing, use the exact local URL such as `http://127.0.0.1:3000/` and add it to the Supabase redirect allow-list.

## Google Cloud configuration

Create a **Web application** OAuth client in Google Auth Platform.

Authorized JavaScript origins:

```text
https://www.jyyramprem.my.id
```

For local development, temporarily add the exact local origin, such as:

```text
http://127.0.0.1:3000
```

Authorized redirect URI:

Use this Supabase Auth callback URI for this project:

```text
https://jfjbdenqepaagxfysaar.supabase.co/auth/v1/callback
```

Do not set the Google callback directly to `/api/auth/google`.

Keep the requested Google scopes minimal: `openid`, email and profile are sufficient for normal login/profile identity.

## Environment

`APP_URL` controls the final post-login redirect. In production set:

```env
APP_URL=https://www.jyyramprem.my.id
```

No new Google secret environment variable is required by the application server.

## Existing account behavior

Supabase Auth supports automatic identity linking for a verified matching email, so a Google login can link to an existing account rather than unnecessarily creating a separate identity when the email matches.

## Troubleshooting

- `redirect_uri not allowed`: verify the URL Configuration allow-list in Supabase and the callback URI registered in Google.
- `Provider not enabled`: enable Google under Supabase Authentication → Providers.
- Returned to login with “Login Google gagal”: check Google provider configuration and redirect URLs; the app intentionally hides raw OAuth error details from the user.
- Local login works but production fails: set production `APP_URL` to the canonical public URL and ensure only that URL is used for the final redirect.

## Safety / regression rules

- Do not modify the existing email registration OTP flow.
- Do not expose Google Client Secret in source or frontend code.
- Do not add a database migration only for Google sign-in.
- Do not accept arbitrary `redirectTo` values from the browser.
- Do not call `supabase db push` to production for this feature unless a real database migration is introduced and the canonical migration reconciliation policy allows it.
