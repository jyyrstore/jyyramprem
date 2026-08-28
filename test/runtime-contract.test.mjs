import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const owner = fs.readFileSync(path.join(root, "public/js/owner.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "scripts/run-due-broadcasts.mjs"), "utf8");

function routes(source) {
  return new Set([...source.matchAll(/app\.(?:get|post|patch|put|delete)\(\s*["']([^"']+)/g)].map((m) => m[1]));
}

function balancedCss(relative) {
  let text = fs.readFileSync(path.join(root, relative), "utf8");
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  text = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    assert.ok(depth >= 0, `${relative}: extra closing brace`);
  }
  assert.equal(depth, 0, `${relative}: unclosed CSS brace`);
}

test("Owner API surface is connected to its required runtime routes", () => {
  const r = routes(server);
  for (const route of [
    "/api/owner/faq",
    "/api/owner/help",
    "/api/owner/login-activity",
    "/api/owner/maintenance",
    "/api/owner/broadcasts/:id/execute",
  ]) assert.ok(r.has(route), `missing route: ${route}`);
});

test("Owner frontend endpoints and scheduled worker targets exist", () => {
  for (const endpoint of ["/api/owner/faq", "/api/owner/help", "/api/owner/login-activity", "/api/owner/maintenance"]) {
    assert.ok(owner.includes(endpoint), `owner.js missing ${endpoint}`);
  }
  assert.match(worker, /\/api\/owner\/broadcasts\/\$\{item\.id\}\/execute/);
  assert.match(server, /app\.post\(['"]\/api\/owner\/broadcasts\/:id\/execute['"]/);
});

test("Critical Home and Login CSS are structurally balanced", () => {
  balancedCss("public/css/home.css");
  balancedCss("public/css/login.css");
});

test("Premium activation has an atomic server-side claim contract", () => {
  assert.match(server, /claim_premium_activation/);
  assert.match(server, /ACTIVATION_IN_PROGRESS/);
  assert.match(server, /premium_activation_claim_token/);
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260827000000_harden_premium_activation_claim.sql"), "utf8");
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_premium_activation/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.release_premium_activation_claim/);
});
