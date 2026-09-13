import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "public/js/auth.js"), "utf8");
const login = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0, `missing section start: ${start}`);
  assert.ok(b > a, `missing section end: ${end}`);
  return source.slice(a, b);
}

test("REGISTER uses Supabase signUp and does not auto-create via Admin API", () => {
  const s = section(server, 'app.post("/api/auth/register"', 'app.post("/api/auth/resend-verification"');
  assert.match(s, /supabaseAuth\.auth\.signUp\(/);
  assert.doesNotMatch(s, /admin\.createUser\(/);
  assert.doesNotMatch(s, /signInWithOtp\(/);
});

test("REGISTER resend uses Supabase signup resend", () => {
  const s = section(server, 'app.post("/api/auth/resend-verification"', 'app.post("/api/auth/verify-email"');
  assert.match(s, /sendSignupVerificationEmail/);
  assert.match(server, /supabaseAuth\.auth\.resend\(\{\s*type:\s*"signup",\s*email:/s);
});

test("REGISTER verification requires exactly six digits and verifies an email OTP", () => {
  const s = section(server, 'app.post("/api/auth/verify-email"', 'app.get(\n  "/api/config"');
  assert.match(s, /!\/\^\\d\{6\}\$\//);
  assert.match(s, /supabaseAuth\.auth\.verifyOtp\(\{\s*email,\s*token:\s*code,\s*type:\s*"email"/s);
});

test("REGISTER OTP verification immediately continues to the portal-access gate", () => {
  const s = section(auth, "await AMAuth.verifyOtp(", "/* -----------------------------------------\n       LOGIN");
  assert.match(s, /await continueAfterAuth\(\)/);
  assert.doesNotMatch(s, /navigate\("login"/);
  assert.match(auth, /showPortalTokenGate\(\)/);
});

test("REGISTER OTP UI stays hidden until registration step 1 succeeds", () => {
  assert.match(auth, /registerOtpStep = false/);
  assert.match(auth, /registerMode && registerOtpStep/);
  assert.match(auth, /submitButton\.textContent = registerMode/);
  assert.match(auth, /\? \(registerOtpStep \? "VERIFY CODE" : "CREATE ACCOUNT"\)/);
  assert.match(login, /maxlength="6"/);
  assert.match(login, /autocomplete="one-time-code"/);
  assert.match(login, /pattern="\[0-9\]\{6\}"/);
});

test("Provider Generate/Magic-Link surface remains present and untouched by OTP-specific contract", () => {
  assert.match(server, /\/api\/generate/);
  assert.match(server, /send-magiclink/);
  assert.match(server, /rawLink/);
  assert.match(server, /apply-premium/);
});
