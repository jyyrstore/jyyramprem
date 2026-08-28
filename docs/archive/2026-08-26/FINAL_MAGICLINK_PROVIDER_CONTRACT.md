# Magic-Link Provider Contract

## Production flow

1. `POST /api/v1/send-magiclink`
   - Receives the user email.
   - A successful HTTP response with `success=true` means the provider accepted the delivery request.
   - The response is **acceptance-only** and must not be treated as a magic-link payload.

2. User retrieves the fresh magic link from the email inbox and pastes the URL into the portal.

3. `POST /api/v1/verify-account`
   - Receives the user email and the user-supplied action URL.
   - The portal validates the returned identity token before storing it.

4. Provider ID token
   - Must have a valid JWT structure and claims.
   - Email must match the generated account email.
   - `email_verified` must be true.
   - Expiration must be valid.
   - The token is encrypted at rest and never returned to the browser.

5. `POST /api/v1/apply-premium`
   - Uses only the server-side decrypted provider token.
   - Premium is considered active only when the provider reports `status=success` and `valid=true`.

## Security requirements

- Never log or return raw provider ID tokens, passwords, or action URLs containing secrets.
- Never accept a JWT solely because it has three JWT segments.
- Never treat an action URL as valid solely because its hostname/path looks correct.
- Never expose the encrypted token or encryption key to the browser.
