import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/html/owner.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/js/owner.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('owner UI exposes existing member detail/profile and pagination controls', () => {
  for (const id of ['memberStatusFilter','memberEditor','memberDisplayName','memberNotes','memberEditorSave','memberPrev','memberNext']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const token of ['/api/owner/members/', 'method: "PATCH"', 'memberPrev', 'memberNext']) {
    assert.match(js, new RegExp(token.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
  assert.match(server, /app\.patch\("\/api\/owner\/members\/:id"/);
});

test('owner UI exposes full FAQ and Help CRUD controls backed by existing routes', () => {
  for (const id of ['faqCategory','faqSortOrder','faqPublished','faqCancelEdit','helpCategory','helpSortOrder','helpPublished','helpCancelEdit']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(js, /\/api\/owner\/faq\//);
  assert.match(js, /\/api\/owner\/help\//);
  assert.match(js, /faq-delete/);
  assert.match(js, /help-delete/);
  for (const route of ['/api/owner/faq/:id','/api/owner/help/:id']) assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
});

test('owner UI exposes broadcast execute and real login pagination', () => {
  assert.match(js, /broadcast-execute/);
  assert.match(js, /\/execute`/);
  assert.match(html, /id=["']loginPrev["']/);
  assert.match(html, /id=["']loginNext["']/);
  assert.match(js, /\/api\/owner\/login-activity\?/);
});

test('server disables stale caching for HTML, API, CSS and JS while preserving cache for static media/fonts', () => {
  assert.match(server, /Cache-Control.*no-store/);
  assert.ok(server.includes("if (/\\.(?:css|js)$/i.test(filePath))"));
  assert.ok(server.includes("no-cache, no-store, must-revalidate"));
});
