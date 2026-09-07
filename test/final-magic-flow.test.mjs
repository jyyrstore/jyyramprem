import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const home = fs.readFileSync(new URL("../public/js/home.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260826034000_split_magic_verification_from_premium_activation.sql", import.meta.url), "utf8");

test("target flow uses user email and fresh send-magiclink", () => {
  const start = server.indexOf('app.post(\n  "/api/generate"');
  const end = server.indexOf('/* =========================================================\n   HTML PAGE ROUTES', start);
  const body = server.slice(start, end);
  assert.match(body, /normalizeUserEmail\(req\.body\?\.email\)/);
  assert.match(body, /callProviderSendMagicLink\(\{ providerBase, providerKey, email: emailInput\.value \}/);
  assert.match(body, /provider_response/);
  assert.doesNotMatch(body, /createMailTmMailbox/);
  assert.doesNotMatch(body, /auto-activate/);
});

test("verify stage is separate from premium activation", () => {
  const verifyStart = server.indexOf('app.post(\n  "/api/accounts/:id/verify-email"');
  const applyStart = server.indexOf('app.post(\n  "/api/accounts/:id/apply-premium"');
  const verify = server.slice(verifyStart, applyStart);
  assert.match(verify, /callProviderVerifyAccount/);
  assert.match(verify, /encryptedToken/);
  assert.match(verify, /premiumApplied: false/);
  assert.doesNotMatch(verify, /callProviderApplyPremium/);
});

test("apply stage requires verification and consumes encrypted token server-side", () => {
  const start = server.indexOf('app.post(\n  "/api/accounts/:id/apply-premium"');
  const end = server.indexOf('app.get(\n  "/api/accounts"', start);
  const apply = server.slice(start, end);
  assert.match(apply, /email_verification_status !== "verified"/);
  assert.match(apply, /decryptProviderIdToken/);
  assert.match(apply, /callProviderApplyPremium/);
  assert.match(apply, /provider_id_token_encrypted: null/);
  assert.match(apply, /premiumApplied: true/);
});

test("provider ID token is never returned to the frontend", () => {
  const routeStart = server.indexOf('app.post(\n  "/api/accounts/:id/verify-email"');
  const routeEnd = server.indexOf('app.get(\n  "/api/accounts"', routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.doesNotMatch(route, /return res\.json\([\\s\\S]*idToken/);
  assert.match(route, /provider_id_token_encrypted/);
});

test("frontend implements send -> paste -> verify -> confirm -> activate", () => {
  assert.match(home, /\/api\/generate/);
  assert.match(home, /body: JSON\.stringify\(\{ email \}\)/);
  assert.match(home, /rawMagicLinkInput/);
  assert.match(home, /\/verify-email/);
  assert.match(home, /\/apply-premium/);
  assert.match(home, /Generate \/ Activate/);
  assert.doesNotMatch(home, /mailboxPassword/);
  assert.doesNotMatch(home, /webmail/);
  assert.match(home, /resendMagicLinkBtn/);
  assert.match(home, /deliveryStatusNote/);
  assert.match(html, /id="home-email"/);
  assert.match(html, /required/);
});

test("migration adds encrypted provider token storage", () => {
  assert.match(migration, /provider_id_token_encrypted/);
  assert.match(migration, /provider_token_expires_at/);
});
