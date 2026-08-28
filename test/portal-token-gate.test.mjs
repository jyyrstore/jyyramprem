import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");
const auth = fs.readFileSync(new URL("public/js/auth.js", root), "utf8");
const client = fs.readFileSync(new URL("public/js/auth-client.js", root), "utf8");
const migration = fs.readFileSync(new URL("supabase/migrations/20260828000000_portal_access_token_gate_v1.sql", root), "utf8");

test("portal token gate contract exists", () => {
  assert.match(server, /\/api\/access\/status/);
  assert.match(server, /\/api\/access\/request/);
  assert.match(server, /\/api\/access\/verify/);
  assert.match(server, /PORTAL_TOKEN_REQUIRED/);
  assert.match(server, /hashPortalToken/);
  assert.match(auth, /showPortalTokenGate/);
  assert.match(auth, /verifyPortalTokenFromGate/);
  assert.match(client, /verifyPortalToken/);
  assert.match(migration, /portal_access_tokens/);
  assert.match(migration, /token_hash text NOT NULL UNIQUE/);
  assert.match(migration, /portal_access_grants/);
  assert.match(migration, /portal_token_requests/);
  assert.doesNotMatch(server, /console\.log\([^\n]*\btoken\b[^\n]*\)/i);
});
