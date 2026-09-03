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


test("portal token trial modes and permanent mode are wired end-to-end", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260903170000_portal_token_trial_modes_v1.sql", import.meta.url), "utf8");
  const ownerHtml = fs.readFileSync(new URL("../public/html/owner.html", import.meta.url), "utf8");
  const ownerJs = fs.readFileSync(new URL("../public/js/owner.js", import.meta.url), "utf8");
  const homeJs = fs.readFileSync(new URL("../public/js/home.js", import.meta.url), "utf8");
  for (const mode of ["15_days", "30_days", "permanent"]) {
    assert.match(server, new RegExp(mode));
    assert.match(ownerHtml, new RegExp(`data-token-duration=["']${mode}["']`));
  }
  assert.match(server, /duration_mode: durationMode/);
  assert.match(server, /getPortalTokenExpiration/);
  assert.match(server, /expiresAt: persisted\.expires_at \?\? data\.expires_at \?\? null/);
  assert.match(migration, /ALTER COLUMN expires_at DROP NOT NULL/);
  assert.match(migration, /g\.expires_at IS NULL OR g\.expires_at > now\(\)/);
  assert.match(migration, /v_token\.expires_at IS NOT NULL AND v_token\.expires_at <= v_now/);
  assert.match(ownerJs, /selectedPortalTokenDuration/);
  assert.match(ownerJs, /duration_mode: durationMode/);
  assert.match(homeJs, /AMAuth\.signOut\(\)\.catch/);
});
