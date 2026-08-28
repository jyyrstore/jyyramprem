import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProviderContract, extractProviderEmail } from '../lib/provider-contract.js';
import { extractProviderVerified, extractProviderIdToken } from '../lib/provider-verification-contract.js';
import { normalizeMagicLink, pickMagicLink } from '../lib/magiclink-contract.js';

const okResponse = { ok: true, status: 200 };
const good = {
  success: true,
  email: 'alightfree-test@example.com',
  premium: { result: { status: 'success', valid: true } },
};

test('provider contract accepts a complete successful activation', () => {
  assert.deepEqual(validateProviderContract(good, okResponse), { valid: true, errors: [] });
});

test('HTTP 200 with success false is rejected', () => {
  const result = validateProviderContract({ ...good, success: false }, okResponse);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('SUCCESS_FLAG_FALSE'));
});

test('HTTP 200 without valid premium is rejected', () => {
  const result = validateProviderContract({ ...good, premium: { result: { status: 'success', valid: false } } }, okResponse);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('PREMIUM_NOT_VALID'));
});

test('HTTP 200 without premium result is rejected', () => {
  const result = validateProviderContract({ success: true, email: good.email }, okResponse);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('PREMIUM_RESULT_MISSING'));
});



test('V1 premium contract accepts success + valid result', () => {
  const response = { ok: true, status: 200 };
  const payload = {
    success: true,
    email: 'jyyramprem-12345678@emalupe.com',
    data: { result: { status: 'success', valid: true } },
  };
  assert.deepEqual(validateProviderContract({ ...payload, premium: { result: payload.data.result } }, response), { valid: true, errors: [] });
});

test('provider contract still rejects success without valid premium', () => {
  const response = { ok: true, status: 200 };
  const payload = {
    success: true,
    email: 'alightfree-test@example.com',
    premium: { result: { status: 'success', valid: false } },
  };
  const result = validateProviderContract(payload, response);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('PREMIUM_NOT_VALID'));
});


test('magic-link contract rejects unexpected hosts and non-HTTPS links', () => {
  assert.equal(normalizeMagicLink('http://alightcreative.com/auth_action?oobCode=x').valid, false);
  assert.equal(normalizeMagicLink('https://evil.example/auth_action?oobCode=x').valid, false);
});

test('magic-link contract accepts only known Alight action-link paths', () => {
  const first = normalizeMagicLink('https://alightcreative.com/auth_action?oobCode=x');
  const second = normalizeMagicLink('https://alight-creative.firebaseapp.com/__/auth/links?mode=signIn&oobCode=x');
  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  assert.equal(pickMagicLink('bad', first.value).value, first.value);
});


test('provider verification fixture matches the live profile.user response shape', () => {
  const liveLike = {
    success: true,
    email: 'jyyr26@emalupe.com',
    profile: {
      idToken: 'eyJ.fake.fixture',
      user: {
        email: 'jyyr26@emalupe.com',
        emailVerified: true,
      },
    },
  };

  assert.equal(extractProviderVerified(liveLike), true);
  assert.equal(extractProviderIdToken(liveLike), liveLike.profile.idToken);
  assert.equal(extractProviderEmail(liveLike).value, liveLike.profile.user.email);
});

test('provider verification extractor fails closed when verification flag is absent', () => {
  assert.equal(extractProviderVerified({ success: true, profile: { idToken: 'eyJ.fixture' } }), null);
});

test('provider verification extractor accepts nested data.profile.user and result.user shapes', () => {
  assert.equal(extractProviderVerified({ data: { profile: { user: { emailVerified: true } } } }), true);
  assert.equal(extractProviderVerified({ result: { user: { emailVerified: false } } }), false);
  assert.equal(extractProviderIdToken({ result: { profile: { idToken: 'eyJ.result.fixture' } } }), 'eyJ.result.fixture');
});
