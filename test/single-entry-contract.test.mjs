import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const index = read('public/index.html');
const router = read('public/js/router.js');
const nav = read('public/js/nav.js');
const auth = read('public/js/auth.js');
const home = read('public/js/home.js');
const dashboard = read('public/js/dashboard.js');
const setting = read('public/js/setting.js');
const owner = read('public/js/owner.js');
const resetPassword = read('public/js/reset-password.js');
const help = read('public/js/help.js');
const protection = read('public/js/ui-protection.js');
const publicRoutes = read('api/routes/public.routes.js');
const releaseRoutes = read('api/routes/release.routes.js');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const serviceWorker = read('public/service-worker.js');
const vercel = read('vercel.json');

const expectedViews = ['login', 'home', 'dashboard', 'setting', 'owner', 'app'];
const allPreservedUtilityViews = [...expectedViews, 'help', 'reset-password'];
const legacyFiles = [
  'public/app.html',
  'public/html/index.html',
  'public/html/login.html',
  'public/html/home.html',
  'public/html/dashboard.html',
  'public/html/setting.html',
  'public/html/owner.html',
  'public/html/help.html',
  'public/html/reset-password.html',
  'public/html/app-intro.html',
];
const legacyPaths = ['/index.html', '/login.html', '/home.html', '/dashboard.html', '/setting.html', '/owner.html', '/app.html'];

function idsIn(html) {
  return [...html.matchAll(/\sid=["']([^"']+)["']/gi)].map((m) => m[1]);
}

function sectionTemplateHtml(view) {
  const pattern = new RegExp(`<section[^>]*data-view=["']${view}["'][^>]*>[\\s\\S]*?<template>([\\s\\S]*?)<\\/template>[\\s\\S]*?<\\/section>`);
  return index.match(pattern)?.[1] || '';
}

test('single entry point contains every canonical application view', () => {
  assert.equal(exists('public/index.html'), true);
  for (const view of allPreservedUtilityViews) {
    assert.match(index, new RegExp(`id=["']view-${view}["']`));
    assert.match(index, new RegExp(`data-view=["']${view}["']`));
  }
  assert.match(index, /\/js\/auth-client\.js/);
  assert.match(index, /\/js\/router\.js/);
});

test('legacy public HTML entry files are removed after migration', () => {
  assert.deepEqual(legacyFiles.filter(exists), []);
});

test('only the active view is materialized into the live DOM', () => {
  assert.match(router, /template\.content\.cloneNode\(true\)/);
  assert.match(router, /current\.remove\(\)/);
  for (const view of allPreservedUtilityViews) {
    const html = sectionTemplateHtml(view);
    assert.ok(html, `template missing for ${view}`);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids inside ${view} template`);
  }
});

test('view navigation uses clean canonical paths and does not use pathname as privilege', () => {
  assert.match(router, /window\.JYYRApp = \{ showView, navigate/);
  assert.doesNotMatch(router, /(?:location|window\.location)\.(?:assign|replace|reload)\(/);
  assert.doesNotMatch(router, /location\.(?:href|pathname)\s*=/);
  assert.match(router, /const ROUTES = \{/);
  assert.match(router, /dashboard: "\/dashboard"/);
  assert.match(router, /setting: "\/setting"/);
  for (const source of [auth, home, dashboard, setting, owner, resetPassword, help, nav]) {
    assert.doesNotMatch(source, /(?:location|window\.location)\.(?:href|assign|replace)\s*=\s*[`'\"]\/(?:login|home|dashboard|setting|owner|app|help|reset-password)\.html/);
  }
});

test('legacy page URLs redirect to clean canonical routes while the SPA remains single-entry', () => {
  const legacyPairs = {
    '/index.html': '/',
    '/login.html': '/login',
    '/home.html': '/',
    '/dashboard.html': '/dashboard',
    '/setting.html': '/setting',
    '/owner.html': '/owner',
    '/app.html': '/app',
  };
  for (const [legacyPath, canonicalPath] of Object.entries(legacyPairs)) {
    assert.ok(publicRoutes.includes(`"${legacyPath}": "${canonicalPath}"`), `missing legacy redirect ${legacyPath}`);
  }
  assert.match(publicRoutes, /res\.redirect\(308,/);
  assert.match(publicRoutes, /app\.get\("\/"/);
  assert.match(publicRoutes, /sendFile\("index\.html"/);
  assert.doesNotMatch(releaseRoutes, /app\.get\("\/app"[\s\S]*app-intro\.html/);
  const canonicalBlockStart = publicRoutes.indexOf('for (const canonicalPath of [');
  const canonicalBlockEnd = publicRoutes.indexOf('  ])', canonicalBlockStart);
  const canonicalBlock = publicRoutes.slice(canonicalBlockStart, canonicalBlockEnd);
  for (const canonicalPath of ['/dashboard', '/setting', '/owner', '/app', '/help', '/maintenance', '/reset-password', '/login']) {
    assert.ok(canonicalBlock.includes(`"${canonicalPath}"`), `missing canonical route ${canonicalPath}`);
  }
});

test('PWA identity and navigation fallback use the canonical root', () => {
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.id, '/');
  assert.match(serviceWorker, /const CACHE_NAME=['"]jyy-r-amprem-app-v4['"]/);
  assert.match(serviceWorker, /caches\.match\(['"]\/["']\)/);
  assert.match(serviceWorker, /\/index\.html|\/\'/);
});

test('authorization remains backend-controlled for protected views', () => {
  assert.match(protection, /getPortalAccess\(\)/);
  assert.match(protection, /response\.status === 403/);
  assert.match(protection, /data\?\.access !== true && gate\.data\?\.owner !== true/);
  assert.doesNotMatch(router, /currentView.*isOwner|viewName.*isOwner/);
  assert.doesNotMatch(router, /localStorage\.(?:getItem|setItem)\([^)]*isOwner/);
});

test('page-specific scripts are isolated from cross-view global lexical collisions', () => {
  assert.match(router, /script\.type = \"module\"/);
  assert.match(router, /baseSrc\.startsWith\(\"\/js\/owner\/\"\)/);
  assert.match(router, /baseSrc !== \"\/js\/owner\.js\"/);
  // Owner feature files intentionally remain classic scripts because their existing
  // modules share the established owner runtime scope. Non-owner page scripts do not.
  assert.match(router, /if \(!baseSrc\.startsWith\(\"\/js\/owner\/\"\)/);
});

test('canonical router is the only frontend view switch mechanism', () => {
  const sources = [index, auth, home, dashboard, setting, owner, resetPassword, help, nav];
  assert.ok(sources.every((source) => !/(?:window\.location|location)\.(?:href|assign|replace)\s*=/.test(source)));
  assert.match(router, /function showView\(viewName/);
  assert.match(router, /function navigate\(viewName/);
  assert.match(router, /data-jyyr-view/);
});

test('Vercel keeps the canonical application behind the API composition root', () => {
  assert.match(vercel, /"src"\s*:\s*"\/\(\.\*\)"[\s\S]*"dest"\s*:\s*"\/api\/index\.js"/);
});
