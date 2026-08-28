import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const home = fs.readFileSync(new URL("../public/js/home.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260823223000_magic_link_delivery_quota.sql", import.meta.url), "utf8");

test("user magic-link quota is consumed only after apply-premium succeeds", () => {
  const applyStart = server.indexOf('app.post(\n  "/api/accounts/:id/apply-premium"');
  const htmlStart = server.indexOf('/* =========================================================\n   HTML PAGE ROUTES', applyStart);
  const apply = server.slice(applyStart, htmlStart);
  const generateStart = server.indexOf('app.post(\n  "/api/generate"');
  const generateEnd = server.indexOf('/* =========================================================\n   HTML PAGE ROUTES', generateStart);
  const generate = server.slice(generateStart, generateEnd);

  assert.match(generate, /callProviderSendMagicLink/);
  assert.doesNotMatch(generate, /consumeMagicLinkQuota\(/);
  assert.match(apply, /callProviderApplyPremium/);
  assert.match(apply, /providerPremiumEmail/);
  assert.match(apply, /consumeMagicLinkQuota\(/);
  assert.match(apply, /"premium_activation"/);
});

test("quota system remains idempotent per account", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.am_magic_link_quota_usage/);
  assert.match(migration, /account_id uuid PRIMARY KEY/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /ALREADY_CONSUMED/);
  assert.match(migration, /DAILY_LIMIT_REACHED/);
});

test("verification and premium activation are separate frontend actions", () => {
  assert.match(home, /verifyBtn/);
  assert.match(home, /applyPremiumBtn/);
  assert.match(home, /\/verify-email/);
  assert.match(home, /\/apply-premium/);
  assert.doesNotMatch(home, /verifyAndApplyBtn/);
});
