import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('local server keeps provider safety quota separate from user magic-link quota', () => {
  assert.match(server, /reserveProviderRequest\(\s*today,\s*PROVIDER_SEND_MAGICLINK_PATH\s*\)/);
  assert.match(server, /consumeMagicLinkQuota\(/);
  assert.match(server, /"premium_activation"/);
  assert.match(server, /MAGIC_LINK_DAILY_LIMIT/);
});

test('No portal mailbox provider is used in the primary user-email activation flow', () => {
  const generateStart = server.indexOf('app.post(\n  "/api/generate"');
  const generateEnd = server.indexOf('/* =========================================================\n   HTML PAGE ROUTES', generateStart);
  const generate = server.slice(generateStart, generateEnd);
  assert.doesNotMatch(generate, /createMailTmMailbox/);
  assert.doesNotMatch(generate, /deleteMailTmMailbox/);
  assert.match(generate, /emailInput\.value/);
});

test('member quota is not consumed in generate', () => {
  const generateStart = server.indexOf('app.post(\n  "/api/generate"');
  const generateEnd = server.indexOf('/* =========================================================\n   HTML PAGE ROUTES', generateStart);
  const generate = server.slice(generateStart, generateEnd);
  assert.doesNotMatch(generate, /consumeMagicLinkQuota\(/);
});
