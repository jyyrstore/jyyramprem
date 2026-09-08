import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const home = fs.readFileSync("public/js/home.js", "utf8");
const owner = fs.readFileSync("api/routes/owner.routes.js", "utf8");

 test("Owner button is hidden by default in the shared shell", () => {
  assert.match(html, /<div[^>]*hidden[^>]*id="ownerDashboardNavWrap"/);
});

test("Owner button is revealed only from the server-trusted owner flag", () => {
  assert.match(home, /ownerNav\.hidden = data\.owner !== true/);
});

test("Owner status endpoint derives ownership server-side", () => {
  assert.match(owner, /app\.get\(\s*["']\/api\/owner\/status["']/);
  assert.match(owner, /const owner = await isOwner\(req\.user\.id\)/);
});

test("Owner navigation remains backend protected", () => {
  assert.match(home, /JYYRApp\?\.navigate\("owner"\)/);
  assert.match(owner, /requireOwner/);
});
