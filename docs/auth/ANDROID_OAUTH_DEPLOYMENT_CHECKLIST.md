# Android Google OAuth — Native Callback Deployment Checklist

## Required production behavior

When the APK starts Google login, it must call:

```text
GET /api/auth/google?client=android
```

The server then passes this exact redirect to Supabase Auth:

```text
jyyramprem://auth/callback
```

No web-domain callback is used for this native flow.

Normal browser login remains on the canonical web URL.

## Supabase

In **Authentication → URL Configuration → Redirect URLs**, add the exact native URI:

```text
jyyramprem://auth/callback
```

The Google provider's external callback remains the Supabase Auth callback URL; the native URI is the final application redirect after Supabase completes authentication.

## Android

The APK must register the `jyyramprem` scheme and `auth` host/path in the activity intent filter and handle the callback intent in `MainActivity`. The Custom Tab starts the external Google authentication step; the deep link returns control to the installed APK.

## Security contract

- Never accept `redirectTo` from a browser query/body/header.
- Only the exact `client=android` marker selects the native callback.
- Do not log access or refresh tokens.
- Keep Google client secrets only in Supabase provider configuration.
