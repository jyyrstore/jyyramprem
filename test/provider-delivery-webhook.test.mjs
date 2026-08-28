import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("delivery webhook prefers codeOrder correlation when provider supplies it", () => {
  assert.match(server, /\.eq\("magic_link_code_order", codeOrder\)/);
  assert.match(server, /if \(codeOrder\) \{/);
  assert.match(server, /Prefer the provider correlation key when available/);
});

test("delivery webhook keeps email/latest-pending fallback only when codeOrder is absent", () => {
  assert.match(server, /\.eq\("email", email\.value\)/);
  assert.match(server, /\.order\("magic_link_requested_at", \{ ascending: false \}\)/);
});
