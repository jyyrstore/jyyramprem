import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const home = fs.readFileSync("public/js/home.js", "utf8");
assert.ok(home.includes('async function pollMagicLinkDelivery(accountIdentifier)'), 'delivery polling must use the canonical accountIdentifier parameter');

test("home page defines escapeHtml before setResultLines uses it", () => {
  assert.match(home, /function escapeHtml\(value\)/);
  assert.match(home, /escapeHtml\(label\)/);
  assert.match(home, /escapeHtml\(value\)/);
  assert.ok(home.indexOf("function escapeHtml") < home.indexOf("function setResultLines"));
});

test("magic-link polling uses the stored generated account id", () => {
  assert.match(home, /pollMagicLinkDelivery\(window\.__lastGeneratedAccountId\)/);
  assert.doesNotMatch(home, /pollMagicLinkDelivery\(accountId\)/);
  assert.doesNotMatch(home, /accountIdentifierentifier/);
});
