import fs from 'node:fs';
import assert from 'node:assert/strict';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../public/js/home.js', import.meta.url), 'utf8');

assert.match(server, /FINAL_MAGIC_FLOW/);
assert.match(server, /flowMode:\s*"user_email_manual_activation"/);
assert.match(server, /generateTriggersSendMagiclink:\s*true/);
assert.match(server, /requireRawMagicLinkBeforeVerify:\s*true/);
assert.match(server, /requireVerifiedBeforePremium:\s*true/);
assert.match(server, /applyPremiumSeparatedFromVerify:\s*true/);
assert.match(server, /callProviderApplyPremium/);
assert.doesNotMatch(server, /createMailTmMailbox/);
assert.doesNotMatch(server, /\/api\/v1\/auto-activate/);
assert.match(home, /rawMagicLinkInput/);
assert.match(home, /verifyBtn/);
assert.match(home, /applyPremiumBtn/);
assert.match(home, /\/apply-premium/);

console.log('TARGET USER-EMAIL FLOW REGRESSION: PASS');
