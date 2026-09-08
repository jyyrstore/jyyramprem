import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.js', 'utf8');
const home = fs.readFileSync('public/js/home.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

test('Step 1 never exposes a provider-returned magic link; mailbox is the only link source', () => {
  assert.doesNotMatch(server, /magicLink:\s*send\.magicLink/);
  assert.match(server, /magicLinkRequiredFrom:\s*"mailbox_or_user_input"/);
  assert.match(server, /magicLinkIncludedInResponse:\s*false/);
});

test('frontend auto-chains verify then apply-premium', () => {
  assert.match(home, /verifyAndApplyMagicLink/);
  assert.match(home, /\/verify-email/);
  assert.match(home, /\/apply-premium/);
  assert.doesNotMatch(home, /if \(d\.magicLink\)/);
  assert.ok(home.includes('pollMagicLinkDelivery(window.__lastGeneratedAccountId)'));
});

test('manual mailbox path remains available when provider omits link', () => {
  assert.ok(home.includes('pollMagicLinkDelivery(window.__lastGeneratedAccountId)'));
  assert.match(home, /rawMagicLinkInput/);
});

test('ui labels expose the one-click continuation', () => {
  assert.match(html, /Verifikasi[\s\S]*Aktifkan/);
});
