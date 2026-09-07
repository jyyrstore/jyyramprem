import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../public/js/setting.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/css/setting.css',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');

test('profile card exposes a compact access-status trigger and modal',()=>{
  assert.match(html,/id="accessStatusTrigger"/);
  assert.match(html,/id="accessStatusModal"/);
  assert.match(html,/id="accessStatusTitle">ACCESS STATUS</);
  assert.match(css,/access-status-trigger/);
  assert.match(css,/access-status-modal/);
});

test('frontend uses backend access_expires_at as the countdown source',()=>{
  assert.match(js,/accessExpiresAt/);
  assert.match(js,/Date\.parse\(expiresAt/);
  assert.match(js,/setInterval\(\(\)=>/);
  assert.doesNotMatch(js,/30 D/);
});

test('remaining-day tone thresholds stay unchanged',()=>{
  assert.match(js,/if\(days<=5\) return 'red'/);
  assert.match(js,/if\(days<=10\) return 'orange'/);
  assert.match(js,/if\(days<=15\) return 'blue'/);
  assert.match(js,/return 'green'/);
  assert.match(js,/return 'expired'/);
});

test('owner access is independent from member token lifetime',()=>{
  assert.match(js,/payload\.owner/);
  assert.match(js,/Owner Access/);
  assert.match(html,/UNLIMITED/);
  assert.match(js,/Token redemption is not required\./);
});

test('member unavailable and expired states use access wording',()=>{
  assert.match(js,/Access Unavailable/);
  assert.match(js,/No active portal access\./);
  assert.match(js,/Access Expired/);
  assert.match(js,/Your portal access has ended\./);
  assert.doesNotMatch(js,/TOKEN TELAH KEDALUWARSA/);
  assert.doesNotMatch(js,/TOKEN TIDAK TERSEDIA/);
});

test('backend access status contract remains canonical and unchanged',()=>{
  assert.match(server,/app\.get\("\/api\/access\/status"/);
  assert.match(server,/portal_get_token_lifetime/);
  assert.match(server,/p_user_id: userId/);
  assert.match(server,/owner,\n      status/);
});

test('clock asset remains the supplied icon asset',()=>{
  assert.match(css,/\/assets\/Icon\/Icon-jam\.png/);
});
