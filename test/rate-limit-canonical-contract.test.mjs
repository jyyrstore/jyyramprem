import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const runtime = fs.readFileSync("lib/runtime/app-runtime.js", "utf8");
const middleware = fs.readFileSync("api/middleware/rate-limit.middleware.js", "utf8");
const member = fs.readFileSync("api/routes/member.routes.js", "utf8");
const publicRoutes = fs.readFileSync("api/routes/public.routes.js", "utf8");
const portalTokenRoutes = fs.readFileSync("api/routes/portal-token.routes.js", "utf8");
const releaseRoutes = fs.readFileSync("api/routes/release.routes.js", "utf8");

const canonicalLimiters = [
  "authRegisterLimiter",
  "authResendLimiter",
  "authVerifyLimiter",
  "portalTokenVerifyLimiter",
  "ownerClaimLimiter",
  "ownerReadLimiter",
  "ownerStatisticsLimiter",
  "ownerMemberReadLimiter",
  "ownerBroadcastMutationLimiter",
  "ownerBroadcastReadLimiter",
  "ownerMemberMutationLimiter",
  "portalTokenPublicLimiter",
  "providerDiagnosticLimiter",
  "generateLimiter",
  "confirmMagicLinkLimiter",
  "resendMagicLinkLimiter",
];

test("rate-limiters have one canonical implementation", () => {
  assert.doesNotMatch(runtime, /express-rate-limit/);
  assert.doesNotMatch(runtime, /createRateLimiters/);
  for (const name of canonicalLimiters) {
    assert.match(middleware, new RegExp(`\\b${name}\\b`), `missing canonical limiter: ${name}`);
  }
});

test("member/public routes consume limiter instances through route dependencies", () => {
  assert.doesNotMatch(member, /const \{[\s\S]*?generateLimiter[\s\S]*?\} = runtime;/);
  assert.doesNotMatch(publicRoutes, /const \{[\s\S]*?portalTokenPublicLimiter[\s\S]*?\} = runtime;/);
  assert.match(member, /generateLimiter,\s*confirmMagicLinkLimiter,\s*resendMagicLinkLimiter/);
  assert.match(publicRoutes, /portalTokenPublicLimiter/);
});

test("Node crypto imports use namespace semantics across production routes", () => {
  const runtime = fs.readFileSync("lib/runtime/app-runtime.js", "utf8");
  const sources = [runtime, member, portalTokenRoutes, releaseRoutes];
  for (const source of sources) assert.match(source, /import \* as crypto from "node:crypto";/);
});

test("revoked owner token history rows do not require plaintext decryption", () => {
  const historyBlock = portalTokenRoutes.slice(portalTokenRoutes.indexOf('app.get("/api/owner/token/history"'), portalTokenRoutes.indexOf('app.post("/api/owner/token/publish"'));
  assert.match(historyBlock, /if \(row\.status !== "revoked"\)/);
  assert.match(historyBlock, /OWNER TOKEN HISTORY DECRYPT SKIPPED/);
});
