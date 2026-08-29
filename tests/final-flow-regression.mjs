import fs from 'node:fs';
import assert from 'node:assert/strict';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const authClient = fs.readFileSync(new URL('../public/js/auth-client.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../public/js/auth.js', import.meta.url), 'utf8');
const owner = fs.readFileSync(new URL('../public/js/owner.js', import.meta.url), 'utf8');

assert.match(server, /FINAL_MAGIC_FLOW/);
assert.match(server, /flowMode:\s*"signup_email_code_then_owner_token"/);
assert.match(server, /signupCooldown:\s*0/);
assert.match(server, /AUTH_EMAIL_RESEND_COOLDOWN_SECONDS/);
assert.match(server, /\/api\/auth\/register/);
assert.match(server, /\/api\/auth\/resend-verification/);
assert.match(server, /\/api\/auth\/verify-email/);
assert.match(server, /admin\.updateUserById/);
assert.match(server, /AUTH_EMAIL_VERIFICATION_TTL_MINUTES/);
assert.match(server, /supabaseAuth\.auth\.signUp/);
assert.match(server, /supabaseAuth\.auth\.resend/);
assert.doesNotMatch(server, /sendVerificationEmail\(/);
assert.doesNotMatch(server, /createMailTmMailbox/);
assert.match(authClient, /\/api\/auth\/register/);
assert.match(authClient, /\/api\/auth\/resend-verification/);
assert.match(authClient, /\/api\/auth\/verify-email/);
assert.match(auth, /startResendCooldown/);
assert.match(auth, /AMAuth\.resendSignupCode/);
assert.match(authClient, /verifyOtp\(email, token, password\)/);
assert.match(owner, /\/api\/owner\/token\/generate/);

console.log('TARGET SIMPLE SIGNUP + EMAIL CODE + OWNER TOKEN FLOW REGRESSION: PASS');
