import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "public/js/auth.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260829201832_enforce_member_suspend_ban_access_v1.sql"), "utf8");

test("server enforces suspended/banned member state at auth boundary", () => {
  assert.match(server, /async function getMemberStatus\(userId\)/);
  assert.match(server, /memberStatus\.status === "suspended" \|\| memberStatus\.status === "banned"/);
  assert.match(server, /MEMBER_BANNED/);
  assert.match(server, /MEMBER_SUSPENDED/);
});

test("owner status actions enforce Supabase Auth ban and unban", () => {
  assert.match(server, /supabase\.auth\.admin\.updateUserById\(req\.params\.id/);
  assert.match(server, /forcedStatus === "active" \? "none" : "876000h"/);
  assert.match(server, /auth_enforced: true/);
});

test("database portal gate and member RPCs fail closed for suspended/banned", () => {
  assert.match(migration, /m\.status='active'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.assert_member_active/);
  assert.match(migration, /Member account is banned/);
  assert.match(migration, /Member account is suspended/);
  assert.equal((migration.match(/PERFORM public\.assert_member_active\(p_user_id\);/g) || []).length, 6);
});

test("login UI handles Supabase Auth ban and app status", () => {
  assert.match(auth, /data\.status === "banned" \|\| data\.status === "suspended"/);
  assert.match(auth, /user_banned/);
});
