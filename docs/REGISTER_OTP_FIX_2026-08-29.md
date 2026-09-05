# REGISTER OTP Fix — 2026-08-29

## Target flow

`REGISTER -> Supabase Auth signUp -> signup verification email -> 6-digit OTP -> verifyOtp -> email verified -> session -> Portal Access Token`

## Preserved flow

`GENERATE -> send-magiclink -> Magic Link -> paste rawLink -> verify-email -> apply-premium`

The Generate/Magic-Link/provider implementation is intentionally unchanged by this fix.

## Source changes

- `server.js`
  - REGISTER now uses `supabaseAuth.auth.signUp()` rather than Admin `createUser()`.
  - REGISTER no longer calls `signInWithOtp()` for signup delivery.
  - Unverified existing accounts return `EMAIL_PENDING_VERIFICATION` so the UI resumes OTP entry instead of falsely treating the account as fully registered.
  - Resend uses `supabaseAuth.auth.resend({ type: "signup", email })`.
  - OTP verification remains `verifyOtp({ email, token, type: "email" })` and only then confirms the Auth user and signs the user in.
- `public/js/auth.js`
  - OTP UI is hidden until registration step 1 succeeds or a pending unverified account is detected.
  - Submit button changes from `CREATE ACCOUNT` to `VERIFY CODE` during OTP step.
  - OTP input is normalized to six digits.
  - Pending/unverified and already-registered states are shown distinctly.
- `public/html/login.html`
  - OTP input is explicitly constrained to six digits and exposes accessible guidance.
- `test/signup-otp-contract.test.mjs`
  - Adds regression coverage for signup, resend, six-digit verification, OTP UI gating, and provider-flow preservation.
- `docs/templates/SUPABASE_AUTH_SIGNUP_OTP_TEMPLATE.html`
  - Hosted Supabase Confirm signup template to paste into Auth Email Templates.

## Validation

`npm test` passes all provider, provider-diagnostic, Magic-Link, flow, registration OTP, runtime, Owner UI, verification, and portal-token tests.

The hosted Supabase Confirm signup email template remains a Dashboard configuration item. It must contain `{{ .Token }}` for the email to present a six-digit OTP rather than a confirmation URL.
