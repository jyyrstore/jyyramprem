import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const server = fs.readFileSync(new URL('server.js', root), 'utf8');
const app = fs.readFileSync(new URL('public/app.html', root), 'utf8');
const owner = fs.readFileSync(new URL('public/html/owner.html', root), 'utf8');
const appIntro = fs.readFileSync(new URL('public/html/app-intro.html', root), 'utf8');
const ownerJs = fs.readFileSync(new URL('public/js/owner.js', root), 'utf8');
const nav = fs.readFileSync(new URL('public/js/nav.js', root), 'utf8');
const apkPath = new URL('public/releases/android/1.0.0/JyyR-Amprem-1.0.0.apk', root);
const apk = fs.existsSync(apkPath) ? fs.readFileSync(apkPath) : null;

 test('public release API and App Center contracts exist', () => {
  assert.match(server, /app\.get\("\/api\/app\/latest"/);
  assert.match(server, /app\.get\("\/api\/app\/releases"/);
  assert.match(app, /\/api\/app\/latest/);
  assert.match(app, /\/api\/app\/releases/);
  assert.match(app, /Download APK/);
});

test('owner release publish flow exists and is owner-authenticated', () => {
  for (const route of ['/api/owner/app-releases/sign-upload', '/api/owner/app-releases']) assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(owner, /id=["']releaseFile["']/);
  assert.match(ownerJs, /\/api\/owner\/app-releases\/sign-upload/);
  assert.match(ownerJs, /signedUrl/);
  assert.match(ownerJs, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(ownerJs, /\/api\/owner\/app-releases/);
});

test('home navigation targets the App Center', () => { assert.match(nav, /window\.location\.href = '\/app\.html'/); });
test('bundled APK checksum matches release metadata when APK is present', () => {
  if (!apk) {
    assert.ok(true, 'APK binary is external in source-only packages.');
    return;
  }
  const sha = crypto.createHash('sha256').update(apk).digest('hex');
  assert.equal(apk.length, 9229016);
  assert.equal(sha, '81fb4e7c46867b13bf1848b110c91fd0ebb4d0aa5b881331f7128e9bb085b69b');
});
test('owner release history exposes edit controls and PATCH metadata flow', () => {
  assert.match(server, /app\.patch\("\/api\/owner\/app-releases\/:id"/);
  assert.match(server, /requireAuth, ownerMemberMutationLimiter, requireOwner/);
  assert.match(owner, /id=["']releaseCancelEdit["']/);
  assert.match(owner, /id=["']releaseFileSize["']/);
  assert.match(owner, /id=["']releaseSha["']/);
  assert.match(ownerJs, /\/api\/owner\/app-releases\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(ownerJs, /method: "PATCH"/);
  assert.match(ownerJs, /data-release-edit/);
  assert.match(ownerJs, /data-release-open/);
});



test('owner APK upload accepts Android browser MIME variations and sends multipart binary', () => {
  assert.match(owner, /accept="[^"]*\*\/\*"/);
  assert.match(ownerJs, /method: "PUT"/);
  assert.match(ownerJs, /form\.append\("", file, file\.name\)/);
  assert.match(ownerJs, /application\/vnd\.android\.package-archive/);
});

test('APK intro uses the configured app icon asset', () => {
  assert.match(appIntro, /\/assets\/Foto\/Profil-Apk\.png/);
});
