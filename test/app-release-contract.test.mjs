import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { inspectApk } from '../lib/apk-manifest.js';

const root = new URL('../', import.meta.url);
const server = fs.readFileSync(new URL('server.js', root), 'utf8');
const app = fs.readFileSync(new URL('public/app.html', root), 'utf8');
const owner = fs.readFileSync(new URL('public/html/owner.html', root), 'utf8');
const appIntro = fs.readFileSync(new URL('public/html/app-intro.html', root), 'utf8');
const ownerJs = fs.readFileSync(new URL('public/js/owner.js', root), 'utf8');
const notifyJs = fs.readFileSync(new URL('public/js/notifications.js', root), 'utf8');
const apkMetaJs = fs.readFileSync(new URL('public/js/apk-metadata.js', root), 'utf8');
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

test('owner release flow uses server-verified Storage finalization', () => {
  for (const route of ['/api/owner/app-releases/sign-upload', '/api/owner/app-releases']) assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(owner, /id=["']releaseFile["']/);
  assert.match(ownerJs, /\/api\/owner\/app-releases\/sign-upload/);
  assert.match(ownerJs, /method: "PUT"/);
  assert.doesNotMatch(ownerJs, /new FormData\(\)/);
  assert.match(ownerJs, /method: "POST", body: JSON\.stringify\(payload\)/);
  assert.match(server, /supabase\.storage\.from\(APP_RELEASE_BUCKET\)\.download/);
  assert.match(server, /crypto\.createHash\("sha256"\)\.update\(buffer\)/);
  assert.match(server, /inspectApk\(buffer\)/);
  assert.match(server, /m\.packageName !== APP_RELEASE_PACKAGE/);
  assert.match(server, /file_size_bytes: verified\.fileSizeBytes/);
  assert.match(server, /sha256: verified\.sha256/);
});

test('APK metadata is read from the real bundled APK', () => {
  if (!apk) return;
  const metadata = inspectApk(apk);
  assert.deepEqual(metadata, { packageName: 'com.jyystore.jyyramprem', versionName: '1.0.0', versionCode: 1, minSdk: 24, targetSdk: 35, applicationFound: true });
  assert.equal(apk.length, 9229016);
  assert.equal(crypto.createHash('sha256').update(apk).digest('hex'), '81fb4e7c46867b13bf1848b110c91fd0ebb4d0aa5b881331f7128e9bb085b69b');
});

test('owner CREATE metadata is automatic and release defaults are fixed', () => {
  assert.match(owner, /Version.*Otomatis dari APK/);
  assert.match(owner, /Version Code.*Otomatis dari APK/);
  assert.match(owner, /Package Name/);
  assert.match(owner, /Minimum SDK/);
  assert.match(owner, /Target SDK/);
  assert.match(owner, /Minimum Version.*Otomatis dari stable release paling awal/);
  assert.match(owner, /option value="stable">Stable/);
  assert.match(owner, /option value="published">Published/);
  assert.match(owner, /releaseMandatory.*disabled/);
  assert.match(ownerJs, /state\.appReleaseEditorMode === "edit"/);
  assert.match(ownerJs, /state\.appReleaseEditorMode !== "edit"/);
});

test('edit mode does not allow changing binary-derived integrity fields', () => {
  assert.match(ownerJs, /sizeInput\.disabled = true/);
  assert.match(ownerJs, /shaInput\.disabled = true/);
  assert.doesNotMatch(ownerJs, /file_size_bytes: Number\(fileSizeValue\)/);
  assert.doesNotMatch(ownerJs, /sha256,\n    min_supported_version/);
  assert.match(server, /for \(const key of \["title","min_supported_version"\]/);
});

test('notification layer deduplicates identical notices and guards close', () => {
  assert.match(notifyJs, /recentNotifications/);
  assert.match(notifyJs, /now - recent\.at < 1800/);
  assert.match(notifyJs, /if \(closed\) return/);
});

test('home navigation targets the App Center', () => { assert.match(nav, /window\.location\.href = '\/app\.html'/); });
test('owner release history exposes edit controls and APK metadata fields', () => {
  assert.match(server, /app\.patch\("\/api\/owner\/app-releases\/:id"/);
  assert.match(server, /requireAuth, ownerMemberMutationLimiter, requireOwner/);
  assert.match(owner, /id=["']releaseCancelEdit["']/);
  for (const id of ['releaseFileSize','releaseSha','releasePackageName','releaseMinSdk','releaseTargetSdk']) assert.match(owner, new RegExp(`id=["']${id}["']`));
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

test('browser APK metadata reader is loaded before owner logic', () => {
  assert.match(apkMetaJs, /window\.JYYRReadApkMetadata/);
  assert.match(owner, /notifications\.js.*apk-metadata\.js.*owner\.js/);
});
