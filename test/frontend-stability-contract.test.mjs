import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const net = read("public/js/net.js");
const router = read("public/js/router.js");
const home = read("public/js/home.js");
const authClient = read("public/js/auth-client.js");
const app = read("public/js/app.js");
const dashboard = read("public/js/dashboard.js");
const setting = read("public/js/setting.js");
const nav = read("public/js/nav.js");
const help = read("public/js/help.js");
const resetPassword = read("public/js/reset-password.js");
const maintenance = read("public/js/maintenance.js");
const protection = read("public/js/ui-protection.js");
const ownerCore = read("public/js/owner/core.js");
const releases = read("public/js/owner/releases.js");
const index = read("public/index.html");
const homeCss = read("public/css/home.css");

const requestFiles = { home, app, dashboard, setting, nav, help, resetPassword, maintenance, protection, ownerCore };

test("browser request helper aborts a hanging request and exposes a safe timeout code", async () => {
  const context = {
    window: { setTimeout, clearTimeout },
    console,
    AbortController,
    fetch(_resource, options = {}) {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        options.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      });
    },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(net, context, { filename: "net.js" });
  await assert.rejects(
    context.window.JYYRNet.fetchWithTimeout("/slow", {}, 20),
    (error) => error?.code === "REQUEST_TIMEOUT" && /terlalu lama/i.test(error.message),
  );
});

test("router rejects stale navigation before URL or DOM mutation and does not poison loaded-script state", () => {
  assert.match(router, /if \(serial !== navigationSerial\) return false;\n    if \(options\.updateUrl\)/);
  assert.match(router, /const nextStyleLinks = await loadCss\(name\);/);
  assert.match(router, /if \(serial !== navigationSerial\) \{\n      nextStyleLinks\.forEach/);
  assert.match(router, /activeStyleLinks = nextStyleLinks;/);
  assert.match(router, /loadedScripts\.add\(key\);/);
  assert.match(router, /script\.remove\(\);/);
  assert.match(router, /const scriptPromises = new Map\(\);/);
  assert.match(router, /async \(error\) => \{[\s\S]*showBootFallback\(\);[\s\S]*completeBootLoader\(\);/);
});

test("Magic Link verification card clips its decorative particle inside the modal", () => {
  const modal = homeCss.match(/#result\.result-card\{[\s\S]*?\n\}/)?.[0] || "";
  const particle = homeCss.match(/#result\.result-card::after\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(modal, /overflow:hidden/);
  assert.match(modal, /isolation:isolate/);
  assert.match(particle, /right:8px/);
  assert.match(particle, /bottom:8px/);
  assert.doesNotMatch(particle, /right:-|bottom:-/);
});

test("all high-risk page HTTP calls use the bounded browser request helper", () => {
  for (const [name, source] of Object.entries(requestFiles)) {
    assert.doesNotMatch(source, /(?<![\w.])fetch\(/, `${name} contains an unbounded fetch()`);
  }
  assert.match(authClient, /fetchWithTimeout\("\/api\/auth\/register"/);
  assert.match(authClient, /fetchWithTimeout\("\/api\/auth\/resend-verification"/);
  assert.match(authClient, /fetchWithTimeout\("\/api\/auth\/verify-email"/);
  assert.match(authClient, /fetchWithTimeout\(path, \{ \...options, headers, cache: "no-store" \}\)/);
  assert.match(app, /JYYRNet\.fetchWithTimeout/);
  assert.match(home, /JYYRNet\.fetchWithTimeout/);
  assert.match(releases, /const uploadTimeoutMs =/);
});

test("maintenance polling cannot overlap and stops acting after leaving the maintenance view", () => {
  assert.match(maintenance, /let running = false/);
  assert.match(maintenance, /if \(running \|\| document\.body\?\.dataset\?\.page !== "maintenance"\) return;/);
  assert.match(maintenance, /finally \{\n      running = false;/);
});

test("shared request helper is loaded before auth-client and router", () => {
  const netIndex = index.indexOf('/js/net.js');
  const authIndex = index.indexOf('/js/auth-client.js');
  const routerIndex = index.indexOf('/js/router.js');
  assert.ok(netIndex >= 0 && authIndex > netIndex && routerIndex > authIndex);
});


test("critical net helper is cached by the service worker shell", () => {
  const sw = read("public/service-worker.js");
  assert.match(sw, /['"]\/js\/net\.js['"]/);
});

test("stylesheet load errors remove the broken link instead of leaving a failed layer", () => {
  assert.match(router, /Stylesheet load failed/);
  assert.match(router, /link\.remove\(\)/);
});


test("router load listeners are registered before DOM insertion", () => {
  const cssAppend = router.indexOf("document.head.appendChild(link);");
  const cssLoad = router.indexOf('link.addEventListener("load"');
  const scriptAppend = router.indexOf("document.body.appendChild(script);");
  const scriptLoad = router.indexOf('script.addEventListener("load"');

  assert.ok(cssAppend >= 0);
  assert.ok(cssLoad >= 0 && cssLoad < cssAppend);

  assert.ok(scriptAppend >= 0);
  assert.ok(scriptLoad >= 0 && scriptLoad < scriptAppend);
});

test("router boot reuses initial session and removes nested view-script timeout", () => {
  assert.match(router, /initialSession/);
  assert.match(router, /window\.JYYRSession\s*=\s*session/);
  assert.match(router, /await showView\(\s*requestedName/);
  assert.doesNotMatch(router, /withTimeout\(loadViewScripts\(name\)/);
});

test("nav reuses router session and health monitoring is singleton background work", () => {
  assert.match(nav, /JYYRSession/);
  assert.match(nav, /let backendHealthRunning = false/);
  assert.match(nav, /let backendHealthTimer = null/);
  assert.match(
    nav,
    /if \(\s*backendHealthRunning\s*\|\|/
  );
  assert.match(nav, /if \(backendHealthTimer !== null\) return/);
  assert.match(nav, /void healthCheck\(\)/);
  assert.doesNotMatch(nav, /await healthCheck\(\)/);
  assert.doesNotMatch(nav, /setInterval\(\s*healthCheck/);
});
