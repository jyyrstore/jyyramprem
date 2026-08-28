import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");
const migration = fs.readFileSync(new URL("supabase/migrations/20260828010000_owner_implicit_portal_access_v1.sql", root), "utf8");

test("server explicitly exempts Owner from the member portal-token gate", () => {
  assert.match(server, /const owner = await isOwner\(user\.id\)/);
  assert.match(server, /req\.isOwner = owner/);
  assert.match(server, /if \(!owner\) \{\s*const access = await hasPortalAccess\(user\.id\)/s);
  assert.match(server, /PORTAL_TOKEN_REQUIRED/);
});

test("Owner and member access semantics are preserved in RPC", () => {
  assert.match(migration, /SELECT public\.is_owner\(p_user_id\)/);
  assert.match(migration, /portal_access_grants/);
  assert.match(migration, /t\.status = 'active'/);
  assert.match(migration, /t\.expires_at > now\(\)/);
  assert.match(migration, /g\.expires_at > now\(\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.portal_has_access\(uuid\) TO authenticated/);
});

test("critical member-facing endpoints remain behind requireAuth", () => {
  for (const endpoint of [
    '/api/accounts',
    '/api/usage',
    '/api/generate',
    '/api/accounts/:id/verify-email',
    '/api/accounts/:id/apply-premium',
    '/api/accounts/:id/magiclink-status',
    '/api/accounts/:id/send-magiclink',
  ]) {
    const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(server, new RegExp(`\\"?${escaped}\\"?\\s*,?\\s*\n?\\s*requireAuth`, 'm'), endpoint);
  }
});
