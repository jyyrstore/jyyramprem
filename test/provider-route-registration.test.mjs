import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const rateLimitSource = fs.readFileSync(new URL("../api/middleware/rate-limit.middleware.js", import.meta.url), "utf8");
const providerRouteSource = fs.readFileSync(new URL("../api/routes/provider.routes.js", import.meta.url), "utf8");

test("provider routes use the canonical internal secret limiter", () => {
  assert.match(rateLimitSource, /const internalSecretLimiter=rateLimit\(/);
  assert.match(rateLimitSource, /internalSecretLimiter,portalTokenPublicLimiter:/);
  assert.match(providerRouteSource, /\/api\/internal\/provider\/magiclink-delivery\", internalSecretLimiter, \(req, res\)/);
});
