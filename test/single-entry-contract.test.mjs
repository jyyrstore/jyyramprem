import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "public/js/app-runtime.js"), "utf8");
const legacy = ["login.html","home.html","dashboard.html","setting.html","owner.html","app.html"];

for (const file of legacy) {
  test(`legacy HTML file is removed: ${file}`, () => {
    assert.equal(fs.existsSync(path.join(root, "public", "html", file)), false);
    assert.equal(fs.existsSync(path.join(root, "public", file)), false);
  });
}

test("single document contains all canonical application views", () => {
  for (const view of ["login","home","dashboard","setting","owner","app"]) {
    assert.match(index, new RegExp(`id=["']view-${view}["'][^>]*data-view=["']${view}["']`));
  }
});

test("all DOM ids in index are unique", () => {
  const ids = [...index.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test("view manager is canonical and only writes the root URL", () => {
  assert.match(runtime, /const VIEWS = \["login", "home", "dashboard", "setting", "owner", "app"/);
  assert.match(runtime, /window\.JYYRApp = \{/);
  assert.match(runtime, /history\.pushState\(\{ view \}, document\.title, "\/"\)/);
  assert.match(runtime, /history\.replaceState\(\{ \s*\.\.\.\(history\.state \|\| \{\}\), view: first \}, document\.title, "\/"\)/);
  assert.doesNotMatch(runtime, /location\.(href|pathname)\s*=/);
});

test("internal navigation does not encode views in URL", () => {
  assert.match(index, /data-app-nav="dashboard" href="\/"/);
  assert.match(index, /data-app-nav="setting" href="\/"/);
  assert.match(index, /data-app-nav="owner" href="\/"/);
});
