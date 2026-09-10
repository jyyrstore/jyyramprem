import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(name) {
  return fs.readFileSync(new URL(`../api/routes/${name}`, import.meta.url), "utf8");
}

test("member premium route imports node:crypto before using crypto.randomBytes", () => {
  const text = source("member.routes.js");
  assert.match(text, /import crypto from ["']node:crypto["'];/);
  assert.equal(text.includes("crypto.randomBytes("), true);
});

test("release sign-upload route imports node:crypto before using crypto.randomUUID", () => {
  const text = source("release.routes.js");
  assert.match(text, /import crypto from ["']node:crypto["'];/);
  assert.equal(text.includes("crypto.randomUUID("), true);
});
