import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authRoutes = readFileSync(
  new URL("../api/routes/auth.routes.js", import.meta.url),
  "utf8"
);

const authClient = readFileSync(
  new URL("../public/js/auth-client.js", import.meta.url),
  "utf8"
);

const settingJs = readFileSync(
  new URL("../public/js/setting.js", import.meta.url),
  "utf8"
);

const indexHtml = readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);

const settingCss = readFileSync(
  new URL("../public/css/setting.css", import.meta.url),
  "utf8"
);

test("self account delete endpoint exists and requires authentication", () => {
  assert.match(
    authRoutes,
    /app\.delete\(["']\/api\/auth\/account["'],\s*requireAuth/
  );

  assert.match(authRoutes, /req\.user\?\.id/);
  assert.match(authRoutes, /req\.user\?\.email/);
});

test("self account delete validates confirmation email against authenticated account", () => {
  assert.match(
    authRoutes,
    /confirmationEmail\s*=\s*String\(req\.body\?\.confirmationEmail/
  );

  assert.match(
    authRoutes,
    /confirmationEmail\s*!==\s*currentEmail/
  );

  assert.match(
    authRoutes,
    /ACCOUNT_DELETE_CONFIRMATION_REQUIRED/
  );
});

test("self account delete protects the Owner account", () => {
  assert.match(authRoutes, /OWNER_ACCOUNT_PROTECTED/);
  assert.match(authRoutes, /owner_lock/);
  assert.match(authRoutes, /status\(403\)/);
  assert.match(authRoutes, /ownerLock\??\.owner_user_id\s*===\s*userId/);
});

test("self account delete uses Supabase server-side admin delete", () => {
  assert.match(
    authRoutes,
    /supabase\.auth\.admin\.deleteUser\(userId,\s*false\)/
  );

  assert.doesNotMatch(
    authClient,
    /service_role/i
  );

  assert.doesNotMatch(
    settingJs,
    /service_role/i
  );
});

test("frontend exposes self account delete API client", () => {
  assert.match(
    authClient,
    /async function deleteAccount\(confirmationEmail\)/
  );

  assert.match(
    authClient,
    /fetchWithTimeout\(["']\/api\/auth\/account["']/
  );

  assert.match(
    authClient,
    /method:\s*["']DELETE["']/
  );

  assert.match(
    authClient,
    /Authorization:\s*`Bearer \$\{session\.access_token\}`/
  );

  assert.match(
    authClient,
    /credentials:\s*["']same-origin["']/
  );

  assert.match(
    authClient,
    /cache:\s*["']no-store["']/
  );

  assert.match(
    authClient,
    /deleteAccount/
  );
});

test("settings Account card places Home as a 44px icon action", () => {
  assert.match(indexHtml, /class=["']account-home-btn["']/);
  assert.match(indexHtml, /aria-label=["']Home["']/);
  assert.match(indexHtml, /id=["']homeIcon["']/);
  const accountCard = indexHtml.match(/<section class=["']card profile-card["'][\s\S]*?<\/section>/)?.[0] || "";
  assert.doesNotMatch(accountCard, /Kembali/);
  assert.match(settingJs, /\['homeIcon','home'\]/);
  assert.match(settingCss, /\.account-home-btn[\s\S]*width:44px[\s\S]*height:44px/);
  assert.match(settingCss, /\.account-home-btn \.ui-icon[\s\S]*width:20px[\s\S]*height:20px/);
});

test("settings Account card keeps Logout and Delete beside each other with trash icon", () => {
  assert.match(indexHtml, /id=["']logoutBtn["']/);
  assert.match(indexHtml, /id=["']deleteAccountBtn["']/);
  assert.match(indexHtml, /id=["']deleteAccountIcon["']/);
  assert.match(settingJs, /\['deleteAccountIcon','trash'\]/);
  assert.match(settingCss, /\.profile-card > \.profile-actions[\s\S]*display:\s*grid/);
  assert.match(settingCss, /\.profile-card > \.profile-actions[\s\S]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(settingCss, /\.profile-card > \.profile-actions \.btn[\s\S]*width:\s*100%/);
  assert.match(settingCss, /\.profile-card > \.profile-actions \.account-delete-btn[\s\S]*width:\s*100%/);
});

test("settings Account metadata remains a three-column aligned grid", () => {
  assert.match(indexHtml, /id=["']profileAccessType["']/);
  assert.match(indexHtml, /id=["']registeredAt["']/);
  assert.match(indexHtml, /id=["']lastLogin["']/);
  assert.match(settingCss, /\.profile-card > \.profile-meta[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});


test("delete account modal keeps keyboard focus contained and trigger state synchronized", () => {
  assert.match(settingJs, /event\.key !== "Tab"/);
  assert.match(settingJs, /event\.shiftKey && document\.activeElement === first/);
  assert.match(settingJs, /!event\.shiftKey && document\.activeElement === last/);
  assert.match(settingJs, /deleteAccountBtn\?\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(settingJs, /deleteAccountBtn\?\.setAttribute\("aria-expanded", "false"\)/);
});

test("settings UI exposes dangerous account deletion confirmation", () => {
  assert.match(indexHtml, /id=["']deleteAccountBtn["']/);
  assert.match(indexHtml, /id=["']deleteAccountModal["']/);
  assert.match(indexHtml, /id=["']deleteAccountEmail["']/);
  assert.match(indexHtml, /id=["']deleteAccountPhrase["']/);
  assert.match(indexHtml, /HAPUS AKUN/);
  assert.match(indexHtml, /id=["']confirmDeleteAccountBtn["']/);
});

test("settings delete flow requires explicit phrase before enabling destructive action", () => {
  assert.match(settingJs, /function canConfirmDeleteAccount\(\)/);
  assert.match(settingJs, /phrase\s*===\s*["']HAPUS AKUN["']/);
  assert.match(settingJs, /confirmDeleteAccountBtn\.disabled/);
  assert.match(settingJs, /AMAuth\.deleteAccount\(confirmationEmail\)/);
});

test("settings delete UI has dedicated danger-zone styling", () => {
  assert.match(settingCss, /ACCOUNT DELETE/);
  assert.match(settingCss, /\.account-delete-btn/);
  assert.match(settingCss, /\.account-delete-modal/);
});
