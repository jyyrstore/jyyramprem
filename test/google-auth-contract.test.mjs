import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const client = fs.readFileSync(new URL("../public/js/auth-client.js", import.meta.url), "utf8");
const auth = fs.readFileSync(new URL("../public/js/auth.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/css/login.css", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../api/routes/auth.routes.js", import.meta.url), "utf8");
const clientModule = fs.readFileSync(new URL("../lib/supabase/client.js", import.meta.url), "utf8");
const limiter = fs.readFileSync(new URL("../api/middleware/rate-limit.middleware.js", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("../public/js/router.js", import.meta.url), "utf8");

test("Google OAuth has a dedicated rate-limited server redirect route", () => {
  assert.match(routes, /app\.get\("\/api\/auth\/google",\s*authGoogleLimiter/);
  assert.match(routes, /supabaseOAuth\.auth\.signInWithOAuth\(/);
  assert.match(routes, /provider:\s*"google"/);
  assert.match(routes, /redirectTo/);
  assert.match(routes, /Cache-Control.*no-store/);
  assert.match(routes, /Referrer-Policy.*no-referrer/);
  assert.match(limiter, /authGoogleLimiter/);
});

test("Google OAuth uses the client-only implicit session flow without changing the shared auth client", () => {
  assert.match(clientModule, /export const supabaseAuth=createClient/);
  assert.match(clientModule, /export const supabaseOAuth=createClient/);
  assert.match(clientModule, /flowType:\"implicit\"/);
  assert.match(clientModule, /persistSession:false/);
});

test("Frontend starts Google OAuth through the first-party server route", () => {
  assert.match(client, /function signInWithGoogle\(\)/);
  assert.match(client, /window\.location\.assign\("\/api\/auth\/google"\)/);
  assert.match(client, /consumeOAuthErrorFromUrl/);
  assert.match(client, /window\.history\.replaceState/);
});

test("Fresh OAuth callback tokens take precedence over a stale stored session", () => {
  const urlOrder = client.indexOf("adoptRecoverySessionFromUrl() || readSession()");
  assert.ok(urlOrder >= 0, "getSession must adopt OAuth/recovery URL session before stored session");
});

test("Login UI exposes Google button in login and register mode", () => {
  const auth = readFileSync(
    new URL("../public/js/auth.js", import.meta.url),
    "utf8"
  );

  assert.match(auth, /googleSignInBtn/);
  assert.match(auth, /registerOtpStep/);
  assert.match(auth, /DAFTAR DENGAN GOOGLE/);
  assert.match(auth, /LOGIN DENGAN GOOGLE/);
  assert.match(
    auth,
    /classList\.toggle\("hidden", registerOtpStep\)/
  );
});

test("OAuth errors are sanitized before being shown", () => {
  assert.match(auth, /Login Google dibatalkan/);
  assert.match(auth, /Login Google gagal/);
  assert.doesNotMatch(auth, /error_description/);
  assert.doesNotMatch(client, /window\.alert\(.*error_description/);
});

test("Google OAuth does not introduce browser-side client secrets", () => {
  assert.doesNotMatch(index, /GOOGLE_CLIENT_SECRET|GOOGLE_SECRET|client_secret/i);
  assert.doesNotMatch(client, /GOOGLE_CLIENT_SECRET|GOOGLE_SECRET|client_secret/i);
  assert.doesNotMatch(auth, /GOOGLE_CLIENT_SECRET|GOOGLE_SECRET|client_secret/i);
});


test("Google OAuth tokens never trigger the password-reset view", () => {
  assert.match(router, /const type = hash\.get\("type"\) \|\| url\.searchParams\.get\("type"\)/);
  assert.match(router, /return hasSessionTokens && type === "recovery"/);
  assert.match(router, /OAuth sign-in.*reset-password/s);
});
