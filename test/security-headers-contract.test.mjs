import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const security = fs.readFileSync(new URL('lib/config/security.config.js', root), 'utf8');
const index = fs.readFileSync(new URL('public/index.html', root), 'utf8');
const router = fs.readFileSync(new URL('public/js/router.js', root), 'utf8');
const appConfig = fs.readFileSync(new URL('lib/config/app.config.js', root), 'utf8');
const authMiddleware = fs.readFileSync(new URL('api/middleware/auth.middleware.js', root), 'utf8');
const ownerMiddleware = fs.readFileSync(new URL('api/middleware/owner.middleware.js', root), 'utf8');
const publicRoutes = fs.readFileSync(new URL('api/routes/public.routes.js', root), 'utf8');
const memberRoutes = fs.readFileSync(new URL('api/routes/member.routes.js', root), 'utf8');

test('security headers contract includes browser hardening without inline script allowance', () => {
  assert.match(security, /Content-Security-Policy/);
  assert.match(security, /default-src 'self'/);
  assert.match(security, /script-src 'self'/);
  assert.doesNotMatch(security, /script-src[^\n]*unsafe-inline/);
  assert.match(security, /base-uri 'self'/);
  assert.match(security, /frame-ancestors 'none'/);
  assert.match(security, /form-action 'self'/);
  assert.match(security, /Cross-Origin-Opener-Policy/);
  assert.match(security, /Strict-Transport-Security/);
  assert.match(security, /img-src 'self'/);
  assert.match(security, /connect-src/);
});

test('shared shell has no inline event handlers for CSP compatibility', () => {
  assert.doesNotMatch(index, /\son[a-z]+\s*=\s*["']/i);
  assert.match(index, /data-hide-on-error="true"/);
  assert.match(router, /addEventListener\("error"/);
  assert.match(router, /dataset\.hideOnError/);
});

test('APK application limit matches live storage bucket contract', () => {
  assert.match(appConfig, /APP_RELEASE_MAX_BYTES=100\*1024\*1024/);
  assert.doesNotMatch(appConfig, /APP_RELEASE_MAX_BYTES=512\*1024\*1024/);
});

test('internal secret endpoints use a rate limiter before secret validation', () => {
  const providerRoutes = fs.readFileSync(new URL('api/routes/provider.routes.js', root), 'utf8');
  const rateLimit = fs.readFileSync(new URL('api/middleware/rate-limit.middleware.js', root), 'utf8');
  assert.match(publicRoutes, /cleanup-idempotency.*internalSecretLimiter/);
  assert.match(providerRoutes, /magiclink-delivery.*internalSecretLimiter/);
  assert.match(rateLimit, /internalSecretLimiter=rateLimit\(/);
});

test('server error logging avoids raw error object leakage in audited middleware/routes', () => {
  assert.doesNotMatch(authMiddleware, /console\.error\("\[AUTH ERROR\]",error\)/);
  assert.doesNotMatch(ownerMiddleware, /console\.error\("\[OWNER AUTH ERROR\]",error\)/);
  assert.doesNotMatch(publicRoutes, /console\.error\('\[MAINTENANCE ERROR\]',e\)/);
  assert.doesNotMatch(publicRoutes, /console\.error\('\[PUBLIC FAQ ERROR\]', e\)/);
  assert.doesNotMatch(publicRoutes, /console\.error\('\[PUBLIC HELP ERROR\]', e\)/);
  assert.doesNotMatch(memberRoutes, /console\.error\([\s\S]{0,100}\[USAGE ERROR\][\s\S]{0,80}error\s*\)/);
});
