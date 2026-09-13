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
    /fetch\(["']\/api\/auth\/account["']/
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
