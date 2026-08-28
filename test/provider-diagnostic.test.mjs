import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeProviderDiagnosticEvent } from "../lib/provider-diagnostic-contract.js";

test("accepts safe provider diagnostic metadata", () => {
  const event = normalizeProviderDiagnosticEvent({
    schemaVersion: "1.0",
    eventId: "evt-1",
    requestId: "req-1",
    stage: "response_received",
    outcome: "ok",
    elapsedMs: 1200,
    provider: {
      host: "alightfree.my.id",
      path: "/api/v1/send-magiclink",
      httpStatus: 200,
      httpOk: true,
      contractValid: true,
    },
  });
  assert.equal(event.schemaVersion, "1.0");
  assert.equal(event.provider.httpStatus, 200);
});

test("rejects raw token fields", () => {
  assert.throws(() => normalizeProviderDiagnosticEvent({
    stage: "response_received",
    provider: { token: "eyJ.fake.secret" },
  }), /SECRET_FIELDS_FORBIDDEN/);
});

test("rejects raw password fields", () => {
  assert.throws(() => normalizeProviderDiagnosticEvent({
    stage: "request_start",
    provider: { password: "not-allowed" },
  }), /SECRET_FIELDS_FORBIDDEN/);
});

test("verify-account diagnostic exposes only sanitized provider error metadata", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /function extractProviderSafeError/);
  assert.match(server, /providerError: result\.providerError/);
  assert.match(server, /URL_REDACTED/);
  assert.match(server, /JWT_REDACTED/);
  assert.match(server, /TOKEN_REDACTED/);
});

test("provider diagnostic contract has no legacy mailbox stage or payload", () => {
  const contract = fs.readFileSync(new URL("../lib/provider-diagnostic-contract.js", import.meta.url), "utf8");
  assert.doesNotMatch(contract, /mailtm/i);
  assert.doesNotMatch(contract, /mail_tm/i);
});


test("send-magiclink diagnostic treats the response as acceptance-only", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const start = server.indexOf("async function callProviderSendMagicLink");
  const end = server.indexOf("async function callProviderApplyPremium", start);
  const section = server.slice(start, end);
  assert.match(section, /providerAccepted/);
  assert.match(section, /deliveryChannel: "email_mailbox"/);
  assert.match(section, /deliveryStatus:/);
  assert.match(section, /magicLinkIncludedInResponse: false/);
  assert.match(section, /magicLinkRequiredFrom: "mailbox_or_user_input"/);
});


test("send-magiclink does not claim delivery from HTTP 200 alone", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /deliveryStatus: providerAccepted \? "provider_accepted_not_delivery_confirmed"/);
  assert.match(server, /deliveryConfirmed: false/);
  assert.match(server, /\/api\/internal\/provider\/magiclink-delivery/);
});

test("resend endpoint exists and is rate limited", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /\/api\/accounts\/:id\/send-magiclink/);
  assert.match(server, /resendMagicLinkLimiter/);
});

test("server imports the dedicated provider verification contract", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /provider-verification-contract\.js/);
  assert.match(server, /extractProviderVerified/);
  assert.match(server, /extractProviderIdToken/);
});
