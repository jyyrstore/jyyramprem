import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), "utf8");
const migration = read("supabase/migrations/20260904150000_canonical_single_user_token_redemption_v7.sql");
const server = read("server.js");
const owner = read("public/js/owner.js");

test("creation leaves token unassigned and starts a 24-hour redemption window", () => {
  assert.match(migration, /INSERT INTO public\.portal_access_tokens\([\s\S]*?status,\s*redemption_expires_at,\s*expires_at,\s*created_by,\s*created_at,\s*assigned_user_id,\s*assigned_request_id,\s*used_at/);
  assert.match(migration, /v_redemption_expires_at\s+timestamptz := v_created_at \+ interval '24 hours'/);
  assert.match(migration, /'active',\s*v_redemption_expires_at,\s*v_redemption_expires_at/s);
  assert.match(migration, /p_owner_user_id,\s*v_created_at,\s*NULL,\s*NULL,\s*NULL/s);
  assert.match(server, /owner_create_portal_token/);
  assert.match(server, /p_duration_mode: durationMode/);
  assert.doesNotMatch(server, /getPortalTokenRedemptionExpiration/);
  assert.doesNotMatch(server, /p_expires_at:/);
});

test("first successful redemption assigns exactly one user", () => {
  assert.match(migration, /SELECT \*/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /SET assigned_user_id = p_user_id/);
  assert.match(migration, /AND assigned_user_id IS NULL/);
  assert.match(migration, /AND used_at IS NULL/);
  assert.match(migration, /status = 'used'/);
  assert.match(migration, /'assigned_user_id', p_user_id/);
  assert.doesNotMatch(migration, /'reusable'\s*,\s*true/i);
  assert.match(migration, /portal_access_tokens_assignment_state_check/);
  assert.match(migration, /ON CONFLICT \(user_id\)/);
});

test("redeemed token uses duration mode for access, not 24 hours", () => {
  assert.match(migration, /access_expires_at/);
  assert.match(migration, /interval '15 days'/);
  assert.match(migration, /interval '30 days'/);
  assert.match(migration, /WHEN 'permanent' THEN NULL/);
  assert.match(migration, /t\.status = 'used'/);
  assert.match(migration, /t\.assigned_user_id = p_user_id/);
  assert.doesNotMatch(migration, /v_grant_expires_at\s+timestamptz\s*:=\s*v_now \+ interval '24 hours'/);
  assert.match(migration, /FROM public\.portal_access_grants g/);
  assert.match(migration, /WHERE g\.user_id = p_user_id/);
});

test("Owner UI exposes available/assigned/redeem expiry semantics", () => {
  assert.match(owner, /AVAILABLE/);
  assert.match(owner, /ASSIGNED/);
  assert.match(owner, /redemption_expires_at/);
  assert.match(owner, /access_expires_at/);
  assert.match(owner, /24 jam/);
  assert.doesNotMatch(owner, /digunakan berulang kali oleh semua user/i);
});
