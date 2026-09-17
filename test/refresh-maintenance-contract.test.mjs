import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const router = fs.readFileSync(new URL("../public/js/router.js", import.meta.url), "utf8");
const authMiddleware = fs.readFileSync(new URL("../api/middleware/auth.middleware.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../api/routes/public.routes.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../lib/runtime/app-runtime.js", import.meta.url), "utf8");
const ownerRoutes = fs.readFileSync(new URL("../api/routes/owner.routes.js", import.meta.url), "utf8");
const uiProtection = fs.readFileSync(new URL("../public/js/ui-protection.js", import.meta.url), "utf8");
const authRoutes = fs.readFileSync(new URL("../api/routes/auth.routes.js", import.meta.url), "utf8");

test("SPA preserves the active view in a clean canonical path for refresh", () => {
  assert.match(router, /const ROUTES = \{/);
  assert.match(router, /dashboard: "\/dashboard"/);
  assert.match(router, /setting: "\/setting"/);
  assert.match(router, /readViewFromUrl\(\)/);
  assert.match(router, /VIEW_BY_PATH/);
  assert.match(router, /window\.addEventListener\("popstate"/);
  assert.match(router, /showView\(viewName, \{ updateUrl: true/);
});

test("authentication and owner middleware have one canonical implementation", () => {
  assert.match(runtime, /createRequireAuth/);
  assert.match(runtime, /createRequireOwner/);
  assert.doesNotMatch(runtime, /async function requireAuth\s*\(/);
  assert.doesNotMatch(runtime, /async function requireOwner\s*\(/);
  assert.match(authMiddleware, /export function createRequireAuth/);
});

test("authenticated non-owners are blocked server-side while maintenance is enabled", () => {
  assert.match(authMiddleware, /getMaintenanceSettings/);
  assert.match(authMiddleware, /maintenance\.maintenance_enabled/);
  assert.match(authMiddleware, /MAINTENANCE_MODE/);
  assert.match(authMiddleware, /!owner/);
  assert.match(runtime, /public_get_maintenance/);
});

test("maintenance status endpoint identifies owners and disables caching", () => {
  assert.match(publicRoutes, /app\.get\('\/api\/maintenance'/);
  assert.match(publicRoutes, /authorization/);
  assert.match(publicRoutes, /isOwner\(user\.id\)/);
  assert.match(publicRoutes, /Cache-Control/);
});

test("maintenance view exists and provides a recheck action", () => {
  assert.match(index, /data-view="maintenance"/);
  assert.match(index, /id="maintenanceRefresh"/);
  assert.match(router, /maintenance: \{ css: \["\/css\/maintenance\.css"\], scripts: \["\/js\/maintenance\.js"\]/);
});

test("owner maintenance toggle invalidates the server cache", () => {
  assert.match(ownerRoutes, /invalidateMaintenanceCache/);
  assert.match(runtime, /function invalidateMaintenanceCache/);
});

test("active authenticated tabs are redirected into maintenance mode", () => {
  assert.match(router, /maintenance\.data\?\.maintenance_enabled === true/);
  assert.match(uiProtection, /JYYRNet\.fetchWithTimeout\("\/api\/maintenance"/);
  assert.match(uiProtection, /navigate\("maintenance"/);
  assert.match(uiProtection, /setInterval\(enforceMaintenanceMode, 15000\)/);
});

test("new account registration actions are blocked during maintenance", () => {
  assert.match(authRoutes, /assertMaintenanceOff/);
  assert.match(authRoutes, /POST\("\/api\/auth\/register"/i);
  assert.match(authRoutes, /POST\("\/api\/auth\/resend-verification"/i);
  assert.match(authRoutes, /POST\("\/api\/auth\/verify-email"/i);
});


test("Google/member bootstrap remains outside the portal-token authorization gate", () => {
  const runtime = fs.readFileSync(new URL("../lib/runtime/app-runtime.js", import.meta.url), "utf8");
  const authRoutes = fs.readFileSync(new URL("../api/routes/auth.routes.js", import.meta.url), "utf8");
  assert.match(runtime, /"\/api\/auth\/bootstrap"/);
  assert.match(authRoutes, /app\.post\("\/api\/auth\/bootstrap", deps\.requireAuth/);
});


test("refresh boot loader cannot remain stuck and preserves the page background", () => {
  const common = fs.readFileSync(new URL("../public/css/common.css", import.meta.url), "utf8");
  const icons = fs.readFileSync(new URL("../public/js/ui-icons-assets.js", import.meta.url), "utf8");
  const nav = fs.readFileSync(new URL("../public/js/nav.js", import.meta.url), "utf8");
  assert.match(router, /REQUEST_TIMEOUT_MS\s*=\s*7000/);
  assert.match(router, /BOOT_TIMEOUT_MS\s*=\s*12000/);
  assert.match(router, /withTimeout\(/);
  assert.match(router, /completeBootLoader\(\)/);
  assert.match(router, /finally[\s\S]*completeBootLoader\(\)/);
  assert.match(router, /JYYRNet\.fetchWithTimeout\("\/api\/maintenance"/);
  assert.match(nav, /JYYRNet\.fetchWithTimeout\('\/api\/health'/);
  const initBlock = nav.match(/async function init\([\s\S]*?\n\s*return user;/)?.[0] || nav;
  assert.doesNotMatch(initBlock, /await appShellReady;/);
  assert.match(common, /#app-loading\.app-loading[\s\S]*background:\s*rgba\(/);
  assert.match(common, /backdrop-filter:\s*blur\(/);
  assert.match(common, /-webkit-backdrop-filter:\s*blur\(/);
  assert.doesNotMatch(index, /html,body\{[^}]*background:transparent/);
  assert.match(index, /html\s*\{\s*background:var\(--bg\);\s*\}/);
  assert.match(icons, /width=\"20\"[\s\S]*height=\"20\"/);
});
