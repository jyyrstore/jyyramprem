import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const client = fs.readFileSync(new URL("../public/js/auth-client.js", import.meta.url), "utf8");
const auth = fs.readFileSync(new URL("../public/js/auth.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/css/login.css", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("../api/routes/auth.routes.js", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../lib/runtime/app-runtime.js", import.meta.url), "utf8");
const clientModule = fs.readFileSync(new URL("../lib/supabase/client.js", import.meta.url), "utf8");
const limiter = fs.readFileSync(new URL("../api/middleware/rate-limit.middleware.js", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("../public/js/router.js", import.meta.url), "utf8");
const manifest = fs.readFileSync(new URL("../../JyyR-Amprem-Android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const mainActivity = fs.readFileSync(new URL("../../JyyR-Amprem-Android/app/src/main/java/com/jyystore/jyyramprem/MainActivity.java", import.meta.url), "utf8");

test("Google OAuth has a dedicated rate-limited server redirect route", () => {
  assert.match(routes, /app\.get\("\/api\/auth\/google",\s*authGoogleLimiter/);
  assert.match(routes, /supabaseOAuth\.auth\.signInWithOAuth\(/);
  assert.match(routes, /provider:\s*"google"/);
  assert.match(routes, /redirectTo/);
  assert.match(routes, /req\.query\?\.client/);
  assert.match(routes, /requestedClient === "android"/);
  assert.match(routes, /jyyramprem:\/\/auth\/callback/);
  assert.match(routes, /isAndroidClient \? "android" : "web"/);
  assert.match(routes, /new URL\(redirectTo\)/);
  assert.match(routes, /Cache-Control.*no-store/);
  assert.match(routes, /Referrer-Policy.*no-referrer/);
  assert.match(limiter, /authGoogleLimiter/);
});

test("Google OAuth uses the client-only implicit session flow without changing the shared auth client", () => {
  assert.match(clientModule, /export const supabaseAuth=createClient/);
  assert.match(clientModule, /export const supabaseOAuth=createClient/);
  assert.match(clientModule, /flowType:\"implicit\"/);
  assert.match(clientModule, /persistSession:false/);
});

test("Google OAuth callbacks bootstrap the account profile before portal access is checked", () => {
  assert.match(auth, /AMAuth\.bootstrapAccount\(\)/);
  assert.match(auth, /bootstrap\?\.response\?\.ok/);
  assert.match(routes, /app\.post\("\/api\/auth\/bootstrap", deps\.requireAuth/);

  assert.match(runtime, /async function ensureMemberProfile\(user\)/);
  assert.match(runtime, /member_profiles/);
  assert.match(runtime, /user_metadata/);

  const runtimeStart = runtime.indexOf("const runtime={") >= 0
    ? runtime.indexOf("const runtime={")
    : runtime.indexOf("const runtime = {");

  const runtimeEnd = runtime.indexOf(
    "export default runtime;",
    runtimeStart
  );

  assert.ok(
    runtimeStart >= 0 && runtimeEnd > runtimeStart,
    "default runtime object harus dapat ditemukan"
  );

  const defaultRuntime = runtime.slice(runtimeStart, runtimeEnd);

  assert.match(
    defaultRuntime,
    /^\s*ensureMemberProfile\s*,\s*$/m,
    "default runtime harus mengekspos ensureMemberProfile"
  );

  assert.match(
    routes,
    /ensureMemberProfile\s*\(\s*req\.user\s*\)/,
    "Google OAuth callback harus melakukan bootstrap profil melalui ensureMemberProfile(req.user)"
  );
});

test("Frontend starts Google OAuth through the first-party server route", () => {
  assert.match(client, /function signInWithGoogle\(\)/);
  assert.match(client, /window\.location\.assign\("\/api\/auth\/google"\)/);
  assert.match(client, /consumeOAuthErrorFromUrl/);
  assert.match(client, /window\.history\.replaceState/);
  assert.match(mainActivity, /isGoogleOAuthStartUrl/);
  assert.doesNotMatch(mainActivity, /isGoogleOAuthAuthorizeUrl/);
});

test("Fresh OAuth callback tokens take precedence over a stale stored session", () => {
  const urlOrder = client.indexOf("adoptRecoverySessionFromUrl() || readSession()");
  assert.ok(urlOrder >= 0, "getSession must adopt OAuth/recovery URL session before stored session");
});

test("Login UI exposes Google button in login and register mode", () => {
  const auth = readFileSync(
    new URL("../public/js/auth.js", import.meta.url),
    "utf8"
  );

  assert.match(auth, /googleSignInBtn/);
  assert.match(auth, /registerOtpStep/);
  assert.match(auth, /DAFTAR DENGAN GOOGLE/);
  assert.match(auth, /LOGIN DENGAN GOOGLE/);
  assert.match(
    auth,
    /classList\.toggle\("hidden", registerOtpStep\)/
  );
});

test("OAuth errors are sanitized before being shown", () => {
  assert.match(auth, /Login Google dibatalkan/);
  assert.match(auth, /Login Google gagal/);
  assert.doesNotMatch(auth, /error_description/);
  assert.doesNotMatch(client, /window\.alert\(.*error_description/);
});

test("Google OAuth does not introduce browser-side client secrets", () => {
  assert.doesNotMatch(index, /GOOGLE_CLIENT_SECRET|GOOGLE_SECRET|client_secret/i);
  assert.doesNotMatch(client, /GOOGLE_CLIENT_SECRET|GOOGLE_SECRET|client_secret/i);
  assert.doesNotMatch(auth, /GOOGLE_CLIENT_SECRET|GOOGLE_SECRET|client_secret/i);
});




test("Android native callback contract is exact and never falls back to a full browser", () => {
  assert.match(manifest, /android:launchMode="singleTask"/);
  assert.match(manifest, /android:scheme="jyyramprem"/);
  assert.match(manifest, /android:host="auth"/);
  assert.match(manifest, /android:path="\/callback"/);
  assert.match(mainActivity, /onNewIntent\(Intent intent\)/);
  assert.match(mainActivity, /jyyramprem\:\/\/auth\/callback/);
  assert.match(mainActivity, /CustomTabsIntent/);
  assert.match(mainActivity, /nativeOAuthSessionResult\(boolean success, String code\)/);
  assert.match(mainActivity, /clearQuery\(\)/);
  assert.match(mainActivity, /\"client\"\.equalsIgnoreCase\(name\)/);
  assert.doesNotMatch(mainActivity, /startActivity\(new Intent\(Intent\.ACTION_VIEW, oauthUri\)\)/);
  assert.match(mainActivity, /Custom Tab tidak tersedia/);
});

test("Native callback validates the Supabase session before Token Gate", () => {
  assert.match(client, /function adoptNativeOAuthSession\(candidate\)/);
  assert.match(client, /fetchSupabaseUser\(session\.access_token\)/);
  assert.match(client, /authenticated = true/);
  assert.match(client, /window\.__JYYR_AUTHENTICATED__ = true/);
  assert.match(auth, /const user = await AMAuth\.getUser\(\)\.catch/);
  assert.match(auth, /AMAuth\.getAuthState\?\.\(\)\.authenticated !== true/);
  assert.match(auth, /await AMAuth\.bootstrapAccount\(\)/);
  assert.match(auth, /await AMAuth\.getPortalAccess\(\)/);
});

test("Native callback keeps credentials in memory until adoption succeeds", () => {
  assert.match(mainActivity, /pendingAuthCallbackUri = uri/);
  assert.match(mainActivity, /callbackUri\.getQueryParameter\("access_token"\)/);
  assert.match(mainActivity, /getFragmentParameter\(callbackUri, "access_token"\)/);
  assert.match(mainActivity, /callbackUri\.getQueryParameter\("refresh_token"\)/);
  assert.match(mainActivity, /callbackUri\.getQueryParameter\("error_description"\)/);
  assert.match(mainActivity, /callbackUri\.getQueryParameter\("state"\)/);
  assert.match(mainActivity, /pendingAuthCallbackUri = null/);
});

test("Google OAuth tokens never trigger the password-reset view", () => {
  assert.match(router, /const type = hash\.get\("type"\) \|\| url\.searchParams\.get\("type"\)/);
  assert.match(router, /return hasSessionTokens && type === "recovery"/);
  assert.match(router, /OAuth sign-in.*reset-password/s);
});
