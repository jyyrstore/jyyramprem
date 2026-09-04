import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260904150000_canonical_single_user_token_redemption_v7.sql", import.meta.url), "utf8");

test("Owner is exempt from the member portal-token gate", () => {
  assert.match(server, /const owner = await isOwner\(user\.id\)/);
  assert.match(server, /req\.isOwner = owner/);
  assert.match(server, /if \(!owner\) \{\s*const access = await hasPortalAccess\(user\.id\)/s);
  assert.match(server, /PORTAL_TOKEN_REQUIRED/);
});

test("Canonical authorization checks assigned user and access expiry", () => {
  assert.match(migration, /public\.is_owner\(p_owner_user_id\)/);
  assert.match(migration, /t\.status = 'used'/);
  assert.match(migration, /t\.assigned_user_id = p_user_id/);
  assert.match(migration, /g\.access_expires_at IS NULL OR g\.access_expires_at > now\(\)/);
  assert.doesNotMatch(migration, /t\.expires_at > now\(\)/);
  assert.doesNotMatch(migration, /g\.expires_at > now\(\)/);
});

test("Critical member-facing endpoints remain behind requireAuth", () => {
  for (const endpoint of ['/api/accounts','/api/usage','/api/generate','/api/accounts/:id/verify-email','/api/accounts/:id/apply-premium','/api/accounts/:id/magiclink-status','/api/accounts/:id/send-magiclink']) {
    const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(server, new RegExp(`\\"?${escaped}\\"?\\s*,?\\s*\\n?\\s*requireAuth`, 'm'), endpoint);
  }
});
