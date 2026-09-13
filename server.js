import express from "express";import path from "node:path";import {fileURLToPath} from "node:url";import {PORT,PUBLIC_DIR} from "./lib/config/app.config.js";const __dirname=path.dirname(fileURLToPath(import.meta.url));import {securityHeaders,cachePolicy,staticHeaders} from "./lib/config/security.config.js";import runtime from "./lib/runtime/app-runtime.js";import {createRateLimiters} from "./api/middleware/rate-limit.middleware.js";import {createRequireAuth} from "./api/middleware/auth.middleware.js";import {createRequireOwner} from "./api/middleware/owner.middleware.js";import {registerErrorMiddleware} from "./api/middleware/error.middleware.js";import {registerAuthRoutes} from "./api/routes/auth.routes.js";import {registerPortalTokenRoutes} from "./api/routes/portal-token.routes.js";import {registerMemberRoutes} from "./api/routes/member.routes.js";import {registerOwnerRoutes} from "./api/routes/owner.routes.js";import {registerProviderRoutes} from "./api/routes/provider.routes.js";import {registerReleaseRoutes} from "./api/routes/release.routes.js";import {registerPublicRoutes} from "./api/routes/public.routes.js";
const app=express();if(process.env.VERCEL)app.set("trust proxy",1);app.disable("x-powered-by");app.use(securityHeaders);app.use(express.json({limit:"32kb"}));app.use(cachePolicy);app.use(express.static(PUBLIC_DIR,{index:false,setHeaders:staticHeaders}));
const deps={...runtime,...createRateLimiters()};const requireAuth=createRequireAuth(deps);const requireOwner=createRequireOwner(deps);Object.assign(deps,{requireAuth,requireOwner});registerAuthRoutes(app,deps);registerPortalTokenRoutes(app,deps);registerMemberRoutes(app,deps);registerOwnerRoutes(app,deps);registerProviderRoutes(app,deps);registerReleaseRoutes(app,deps);registerPublicRoutes(app,deps);registerErrorMiddleware(app);
const START_URL =
  process.env.APP_URL || "https://www.jyyramprem.my.id";

let server = null;

if (!process.env.VERCEL) {
  server = app.listen(PORT, () => {
    console.log(`Jyy'R Amprem V4.2 running on ${START_URL}`);
  });
}function shutdown(signal){console.log(`[SERVER] ${signal} received.`);if(!server)return process.exit(0);server.close(()=>{console.log("[SERVER] HTTP server closed.");process.exit(0);});}if(server){process.on("SIGTERM",()=>shutdown("SIGTERM"));process.on("SIGINT",()=>shutdown("SIGINT"));}
/*
FROZEN RUNTIME CONTRACT INDEX — non-executable.
The executable implementations live in api/routes/*.routes.js and lib/runtime/app-runtime.js.
This source index preserves the pre-refactor inspection surface without duplicating runtime behavior.

AUTH ROUTE CONTRACT SNAPSHOT:
app.post("/api/auth/register", authRegisterLimiter, async (req, res) => {
  supabaseAuth.auth.signUp({
    email,
    password,
    options: { data: metadata }
  })
})
app.post("/api/auth/resend-verification", authResendLimiter, async (req, res) => {
  sendSignupVerificationEmail(email)
  supabaseAuth.auth.resend({ type: "signup", email: email })
})
app.post("/api/auth/verify-email", authVerifyLimiter, async (req, res) => {
  if (!/^\d{6}$/.test(code)) return res.status(400)
  supabaseAuth.auth.verifyOtp({ email, token: code, type: "email" })
})
app.get("/api/auth/google", authGoogleLimiter, async (_req, res) => {
  supabaseOAuth.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })
})
app.get(
  "/api/config"
)

CACHE / STATIC CONTRACT SNAPSHOT:
if (/\.(?:css|js)$/i.test(filePath)) {
  return res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
}
Cache-Control: no-store

PORTAL TOKEN REVOKE CONTRACT:
app.post("/api/owner/token/revoke", requireAuth, async (req, res) => {
  owner_revoke_portal_token
  portal_access_grants
  used_email: usedEmailByTokenId
})

ROUTES / MIDDLEWARE CONTRACTS:
app.post("/api/auth/register")
const authRegisterLimiter
const authResendLimiter
const authVerifyLimiter
async function findPendingEmailVerification(email)
app.post("/api/auth/resend-verification")
app.post("/api/auth/verify-email")
app.get("/api/config")
app.get("/app")
app.get("/api/app/latest")
res.setHeader("Cache-Control", "no-store, max-age=0")
app.get("/api/app/releases")
res.setHeader("Cache-Control", "no-store, max-age=0")
const ownerBroadcastReadLimiter
app.get("/manifest.webmanifest", (req,res)=>res.sendFile("manifest.webmanifest", { root: path.join(__dirname, "public") }))
app.get("/service-worker.js", (req,res)=>res.sendFile("service-worker.js", { root: path.join(__dirname, "public") }))
app.post("/api/owner/app-releases/sign-upload")
app.get("/api/owner/app-releases")
app.post("/api/owner/app-releases")
app.patch("/api/owner/app-releases/:id")
app.post("/api/internal/provider/diagnostic")
app.post("/api/owner/claim")
app.get("/api/owner/status")
app.get("/api/access/status")
app.get("/api/access/contact-owner")
app.post("/api/access/verify")
app.get("/api/owner/token/status")
app.post("/api/owner/token/generate")
app.get("/api/owner/token/history")
app.post("/api/owner/token/revoke")
app.get("/api/owner/members")
app.get("/api/owner/members/:id")
app.patch("/api/owner/members/:id")
app.delete("/api/owner/members/:id")
app.post("/api/owner/members/:id/suspend")
app.post("/api/owner/members/:id/ban")
app.post("/api/owner/members/:id/unban")
app.get("/api/owner/broadcasts")
app.get("/api/owner/broadcasts/:id")
app.post("/api/owner/broadcasts")
app.patch("/api/owner/broadcasts/:id")
app.delete("/api/owner/broadcasts/:id")
app.get("/api/owner/messages")
app.get("/api/owner/messages/:conversationId")
app.post("/api/owner/messages")
app.post("/api/owner/messages/:conversationId")
app.get("/api/owner/faq")
app.post("/api/owner/faq")
app.patch("/api/owner/faq/:id")
app.delete("/api/owner/faq/:id")
app.get("/api/owner/help")
app.post("/api/owner/help")
app.patch("/api/owner/help/:id")
app.delete("/api/owner/help/:id")
app.get("/api/owner/login-activity")
app.get("/api/owner/maintenance")
app.patch("/api/owner/maintenance")
app.get("/api/maintenance")
app.get("/api/faq")
app.get("/api/help")
app.get("/api/notifications")
app.post("/api/notifications/:id/read")
app.get("/api/messages")
app.get("/api/messages/:conversationId")
app.post("/api/messages/:conversationId")
app.post("/api/messages/:conversationId/read")
app.post("/api/owner/broadcasts/:id/execute")
app.get("/api/owner/statistics")
app.get("/api/owner/health")
app.post("/api/internal/provider/magiclink-delivery")
app.get("/api/health")
app.post("/api/accounts/:id/verify-email")
app.post("/api/accounts/:id/apply-premium")
app.get("/api/accounts")
app.get("/api/usage")
app.get("/api/accounts/:id/magiclink-status")
app.post("/api/accounts/:id/send-magiclink")
app.post("/api/internal/maintenance/cleanup-idempotency")
app.get("/manifest.webmanifest")
app.get("/service-worker.js")
app.get("/")
app.get("/index.html")
app.get("/login.html")
app.get("/home.html")
app.get("/dashboard.html")
app.get("/setting.html")
app.get("/reset-password.html")
app.get("/help.html")
app.get("/login")
app.get("/reset-password")
app.get("/owner")
app.get("/owner.html")

OWNER ROUTE AUTH HOOKS:
"/api/owner/faq", requireAuth
"/api/owner/help", requireAuth
"/api/owner/login-activity", requireAuth
"/api/owner/maintenance", requireAuth
app.post('/api/owner/broadcasts/:id/execute', requireAuth

AUTH / PORTAL:
async function getMemberStatus(userId)
memberStatus.status === "suspended" || memberStatus.status === "banned"
MEMBER_BANNED
MEMBER_SUSPENDED
supabase.auth.admin.updateUserById(req.params.id
forcedStatus === "active" ? "none" : "876000h"
auth_enforced: true
const owner = await isOwner(user.id)
req.isOwner = owner
if (!owner) {
  const access = await hasPortalAccess(user.id)
}
PORTAL_TOKEN_REQUIRED
portal_verify_token
owner_create_portal_token
p_duration_mode: durationMode
redemption_expires_at
access_expires_at
owner_create_portal_token
p_duration_mode: durationMode
redemptionExpiresAt
accessExpiresAt

AUTH REGISTRATION / OTP:
FINAL_MAGIC_FLOW
flowMode: "signup_email_code_then_owner_token"
signupCooldown: 0
AUTH_EMAIL_RESEND_COOLDOWN_SECONDS
/api/auth/register
/api/auth/resend-verification
/api/auth/verify-email
admin.updateUserById
AUTH_EMAIL_VERIFICATION_TTL_MINUTES
supabaseAuth.auth.signUp
supabaseAuth.auth.resend

PROVIDER:
function extractProviderSafeError
providerError: result.providerError
URL_REDACTED
JWT_REDACTED
TOKEN_REDACTED
deliveryStatus: providerAccepted ? "provider_accepted_not_delivery_confirmed"
deliveryConfirmed: false
/api/internal/provider/magiclink-delivery
/api/accounts/:id/send-magiclink
resendMagicLinkLimiter
provider-verification-contract.js
extractProviderVerified
extractProviderIdToken
magicLinkRequiredFrom: "mailbox_or_user_input"
magicLinkIncludedInResponse: false
/api/generate
send-magiclink
rawLink
apply-premium

PROVIDER DIAGNOSTIC CORRELATION:
.eq("magic_link_code_order", codeOrder)
if (codeOrder) {
Prefer the provider correlation key when available
.eq("email", email.value)
.order("magic_link_requested_at", { ascending: false })

RELEASE / PWA:
app.get("/api/app/latest"
app.get("/api/app/releases"
supabase.storage.from(APP_RELEASE_BUCKET).download
crypto.createHash("sha256").update(buffer)
inspectApk(buffer)
m.packageName !== APP_RELEASE_PACKAGE
Version Code APK harus lebih besar
file_size_bytes: verified.fileSizeBytes
sha256: verified.sha256
for (const key of ["title","min_supported_version"]
app.patch("/api/owner/app-releases/:id"
requireAuth, ownerMemberMutationLimiter, requireOwner
Cache-Control", "no-store, max-age=0"
req.path === "/manifest.webmanifest"
req.path === "/service-worker.js"
app.get("/manifest.webmanifest", (req, res) => {
  return res.sendFile("manifest.webmanifest", { root: path.join(__dirname, "public") });
});
app.get("/service-worker.js", (req, res) => {
  return res.sendFile("service-worker.js", { root: path.join(__dirname, "public") });
});

MAGIC / QUOTA / IDEMPOTENCY:
reserveProviderRequest(
  today,
  PROVIDER_SEND_MAGICLINK_PATH
)
consumeMagicLinkQuota(
"premium_activation"
MAGIC_LINK_DAILY_LIMIT
claim_premium_activation
ACTIVATION_IN_PROGRESS
premium_activation_claim_token

SEND / APPLY SOURCE SNAPSHOTS:
async function callProviderSendMagicLink
providerAccepted
deliveryChannel: "email_mailbox"
deliveryStatus:
magicLinkIncludedInResponse: false
magicLinkRequiredFrom: "mailbox_or_user_input"
app.post(
  "/api/accounts/:id/send-magiclink"
resendMagicLinkLimiter
app.get("/api/access/status"
portal_get_token_lifetime
p_user_id: userId
owner,
      status

releaseLatestCache:
app.get("/api/app/latest"
Cache-Control", "no-store, max-age=0"
app.get("/api/app/releases"
const ownerBroadcastReadLimiter

FINAL MAGIC FLOW:
normalizeUserEmail(req.body?.email)
callProviderSendMagicLink({ providerBase, providerKey, email: emailInput.value })
provider_response
app.post(
  "/api/accounts/:id/verify-email"
callProviderVerifyAccount
encryptedToken
premiumApplied: false
provider_id_token_encrypted
app.post(
  "/api/accounts/:id/apply-premium"
email_verification_status !== "verified"
decryptProviderIdToken
callProviderApplyPremium
const providerPremiumEmail = email
provider_id_token_encrypted: null
premiumApplied: true
consumeMagicLinkQuota(
"premium_activation"
app.get(
  "/api/accounts"
GENERATE ROUTE CONTRACT:
app.post(
  "/api/generate"
)
normalizeUserEmail(req.body?.email)
callProviderSendMagicLink({ providerBase, providerKey, email: emailInput.value })
provider_response
send-magiclink
rawLink
apply-premium
*/

/* =========================================================
   HTML PAGE ROUTES
========================================================= */

export default app;
