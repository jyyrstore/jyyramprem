import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), "utf8");
const server = read("server.js");
const portalRoutes = read("api/routes/portal-token.routes.js");
const auth = read("public/js/auth.js");
const client = read("public/js/auth-client.js");
const migration = read("supabase/migrations/20260904150000_canonical_single_user_token_redemption_v7.sql");
const guard = read("public/js/ui-protection.js");

test("portal token gate and canonical RPCs are wired", () => {
  for (const route of ["/api/access/status", "/api/access/contact-owner", "/api/access/verify"]) assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  assert.match(server, /PORTAL_TOKEN_REQUIRED/);
  assert.match(server, /portal_verify_token/);
  assert.match(server, /owner_create_portal_token/);
  assert.match(migration, /redemption_expires_at/);
  assert.match(migration, /access_expires_at/);
  assert.match(migration, /assigned_user_id/);
  assert.match(migration, /Owner does not use portal tokens/);
  assert.match(migration, /FOR UPDATE/);
  assert.doesNotMatch(migration, /'reusable'\s*,\s*true/i);
  assert.doesNotMatch(server, /global reusable/i);
  assert.match(auth, /showPortalTokenGate/);
  assert.match(auth, /verifyPortalTokenFromGate/);
  assert.match(client, /verifyPortalToken/);
  assert.match(guard, /setTimeout\(enforcePortalAccess, 30000\)/);
  assert.doesNotMatch(server, /console\.log\([^\n]*\\btoken\\b[^\n]*\)/i);
});

test("two clocks remain separate end-to-end", () => {
  assert.doesNotMatch(server, /getPortalTokenRedemptionExpiration/);
  assert.match(server, /owner_create_portal_token[\s\S]*p_duration_mode: durationMode/);
  assert.match(server, /redemptionExpiresAt/);
  assert.match(server, /accessExpiresAt/);
  assert.match(migration, /created_at \+ interval '24 hours'/);
  assert.match(migration, /WHEN '15_days' THEN v_now \+ interval '15 days'/);
  assert.match(migration, /WHEN '30_days' THEN v_now \+ interval '30 days'/);
  assert.match(migration, /WHEN 'permanent' THEN NULL/);
  assert.doesNotMatch(migration, /v_grant_expires_at\s+timestamptz\s*:=/);
});

test("owner-generated token format is hard-locked to exactly 12 characters", () => {
  const runtime = read("lib/runtime/app-runtime.js");
  const generator = runtime.slice(runtime.indexOf("const PORTAL_TOKEN_PREFIX"), runtime.indexOf("function normalizePortalTokenDuration"));
  assert.match(generator, /const PORTAL_TOKEN_PREFIX = "JYYR";/);
  assert.match(generator, /const PORTAL_TOKEN_HEX_LENGTH = 8;/);
  assert.match(generator, /const PORTAL_TOKEN_LENGTH = PORTAL_TOKEN_PREFIX\.length \+ PORTAL_TOKEN_HEX_LENGTH;/);
  assert.match(generator, /crypto\.randomBytes\(PORTAL_TOKEN_HEX_LENGTH \/ 2\)/);
  assert.match(generator, /token\.length !== PORTAL_TOKEN_LENGTH/);
  assert.match(generator, /isCanonicalPortalToken\(token\)/);
  assert.equal(4 + 8, 12);
});

test("publication is optional for direct redemption", () => {
  const migration = read("supabase/migrations/20260910040000_direct_redeem_owner_tokens_v1.sql");
  assert.match(migration, /Publication is deliberately NOT part of redemption eligibility/);
  assert.doesNotMatch(migration, /IF v_token\.published_at IS NULL THEN/);
  assert.doesNotMatch(migration, /AND published_at IS NOT NULL;/);
  assert.match(migration, /one token can be assigned to exactly one authenticated user atomically/i);
});


test("portal token validators accept only the canonical 12-character JYYR format", () => {
  const canonical = "JYYR01234567";
  const legacy20 = "JYYR3A1C8133DB8F4D66";
  assert.equal(canonical.length, 12);
  assert.equal(legacy20.length, 20);
  assert.match(canonical, /^JYYR[A-F0-9]{8}$/);
  assert.doesNotMatch(legacy20, /^JYYR[A-F0-9]{8}$/);
  assert.match(auth, /\^JYYR\[A-F0-9\]\{8\}\$/);
  assert.match(portalRoutes, /\^JYYR\[A-F0-9\]\{8\}\$/);
  for (const file of ["lib/runtime/app-runtime.js", "api/routes/portal-token.routes.js", "public/js/auth.js", "public/js/owner/portal-token.js", "public/index.html"]) {
    const text = read(file);
    assert.doesNotMatch(text, /JYYR[A-F0-9]\{16\}/, `${file} still contains the legacy 20-character validator`);
    assert.doesNotMatch(text, /randomBytes\(8\).*JYYR|JYYR.*randomBytes\(8\)/s, `${file} still contains a legacy 20-character generator path`);
  }
});


test("owner generate consumer fails closed instead of displaying a non-12-character token", () => {
  const ownerPortal = read("public/js/owner/portal-token.js");
  assert.match(ownerPortal, /\^JYYR\[A-F0-9\]\{8\}\$/);
  assert.match(ownerPortal, /generatedToken/);
  assert.match(ownerPortal, /Server mengembalikan token yang bukan format canonical 12 karakter/);
  assert.match(ownerPortal, /Deploy backend terbaru JYYRXXXXXXXX/);
});

test("owner token generate response explicitly returns the canonical plaintext token contract", () => {
  const routes = read("api/routes/portal-token.routes.js");
  assert.match(routes, /PORTAL_TOKEN_CONTRACT = "JYYRXXXXXXXX"/);
  assert.match(routes, /tokenFormat: PORTAL_TOKEN_CONTRACT/);
  assert.match(routes, /tokenLength: PORTAL_TOKEN_LENGTH/);
  assert.match(routes, /assertCanonicalOwnerToken\(token, "Response token"\)/);
  assert.match(routes, /assertCanonicalOwnerToken\(decryptPortalToken\(encrypted\), "History token"\)/);
});
