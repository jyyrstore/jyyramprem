import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), "utf8");
const server = read("server.js");
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
