
import "dotenv/config";
import * as crypto from "node:crypto";
import {
  decodeJwtPayloadSafe,
  extractProviderEmail,
} from "../provider-contract.js";
import { normalizeMagicLink } from "../magiclink-contract.js";
import { extractProviderVerified, extractProviderIdToken } from "../provider-verification-contract.js";
import { inspectApk } from "../apk-manifest.js";
import { db } from "../repositories/supabase.repository.js";
import { env, envHttpUrl } from "../config/env.js";
import { MAGIC_LINK_DAILY_LIMIT, PROVIDER_DAILY_REQUEST_LIMIT, PROVIDER_TIMEOUT_MS, PROVIDER_MAX_RESPONSE_BYTES, PROVIDER_SEND_MAGICLINK_ENABLED, PROVIDER_SEND_MAGICLINK_PATH, PROVIDER_VERIFY_ACCOUNT_PATH, PROVIDER_APPLY_PREMIUM_PATH, PROVIDER_DIAGNOSTIC_SECRET, PROVIDER_DELIVERY_WEBHOOK_ENABLED, PORTAL_TOKEN_GENERATION_MODES, OWNER_WHATSAPP_URL, PROVIDER_TOKEN_ENCRYPTION_KEY, APP_RELEASE_PACKAGE, APP_RELEASE_BUCKET, APP_RELEASE_MAX_BYTES, TOKEN_CENTER_URL, ECOSYSTEM_HANDOFF_SECRET } from "../config/app.config.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, supabaseAuth } from "../supabase/client.js";
import { SUPABASE_SERVICE_ROLE_KEY, supabase } from "../supabase/admin-client.js";
import { parsePositiveInt, isUuid } from "../utils/validation.js";
import { todayUTC } from "../utils/time.js";
import { safeNumber } from "../utils/numbers.js";
import { publicError } from "../utils/errors.js";
import { createRequireAuth } from "../../api/middleware/auth.middleware.js";
import { createRequireOwner } from "../../api/middleware/owner.middleware.js";


/* =========================================================
   ENV
========================================================= */

function getProviderTokenEncryptionKey() {
  const secret = PROVIDER_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32 || secret.includes("CHANGE_ME")) {
    const error = new Error("PROVIDER_TOKEN_ENCRYPTION_KEY belum dikonfigurasi dengan aman.");
    error.code = "PROVIDER_TOKEN_ENCRYPTION_KEY_MISSING";
    error.status = 500;
    throw error;
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptProviderIdToken(token) {
  const plaintext = String(token || "").trim();
  if (!plaintext) throw new Error("Provider ID token kosong.");
  const key = getProviderTokenEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptProviderIdToken(encrypted) {
  const parts = String(encrypted || "").split(".");
  if (parts.length !== 3) throw new Error("Provider token terenkripsi tidak valid.");
  try {
    const key = getProviderTokenEncryptionKey();
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error("Provider token terenkripsi tidak valid.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    const error = new Error("Provider ID token tidak dapat dibuka secara aman.");
    error.code = "PROVIDER_TOKEN_DECRYPT_FAILED";
    error.status = 500;
    throw error;
  }
}

function normalizeUserEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return { valid: false, value: "", reason: "MISSING" };
  if (email.length > 254) return { valid: false, value: email, reason: "TOO_LONG" };
  if (/\s/.test(email)) return { valid: false, value: email, reason: "WHITESPACE" };
  const match = email.match(/^([^@]+)@([^@]+)$/);
  if (!match) return { valid: false, value: email, reason: "FORMAT" };
  const local = match[1];
  const domain = match[2];
  if (!local || local.length > 64 || !domain || domain.length > 253) return { valid: false, value: email, reason: "FORMAT" };
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return { valid: false, value: email, reason: "FORMAT" };
  if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)) return { valid: false, value: email, reason: "FORMAT" };
  if (!/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(domain)) return { valid: false, value: email, reason: "FORMAT" };
  return { valid: true, value: email, reason: null };
}

/* =========================================================
   SUPABASE / APP CONFIG
========================================================= */

const AUTH_EMAIL_VERIFICATION_TTL_MINUTES = Math.max(5, Number(process.env.AUTH_EMAIL_VERIFICATION_TTL_MINUTES || 30));
const AUTH_EMAIL_RESEND_COOLDOWN_SECONDS = Math.max(15, Number(process.env.AUTH_EMAIL_RESEND_COOLDOWN_SECONDS || 60));

const FINAL_MAGIC_FLOW = Object.freeze({
  flowMode: "signup_email_code_then_owner_token",
  signupCooldown: 0,
  emailVerificationCode: true,
  emailVerificationTtlMinutes: AUTH_EMAIL_VERIFICATION_TTL_MINUTES,
  resendCooldownSeconds: AUTH_EMAIL_RESEND_COOLDOWN_SECONDS,
  requireOwnerTokenBeforePortal: true,
  providerPremiumFlowPreserved: true,
});

/* =========================================================
   SIMPLE EMAIL VERIFICATION
   Public signup has no app cooldown. Only resend is throttled.
========================================================= */
function assertEmailVerificationConfig() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const error = new Error("Supabase Auth email verification belum dikonfigurasi di server.");
    error.code = "AUTH_EMAIL_CONFIG_MISSING";
    error.status = 503;
    throw error;
  }
}

function verificationRequestHash(userId) {
  return crypto.createHash("sha256").update(`${userId}:${Date.now()}:${crypto.randomBytes(16).toString("hex")}`).digest("hex");
}

function publicUser(data) {
  return data ? { id: data.id, email: data.email, email_confirmed_at: data.email_confirmed_at || null, user_metadata: data.user_metadata || {} } : null;
}

async function findPendingEmailVerification(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  const { data, error } = await db.from("am_email_verifications")
    .select("id,user_id,email,expires_at,used_at,attempt_count,created_at")
    .eq("email", target)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}









/* =========================================================
   APP RELEASE / DISTRIBUTION
========================================================= */

function semverParts(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}







function releaseDownloadUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${APP_RELEASE_BUCKET}/${storagePath}`;
}

async function readStoredApk(storagePath) {
  const safePath = String(storagePath || "").trim();
  if (!/^incoming\/[0-9a-f-]{36}\.apk$/i.test(safePath)) throw new Error("Storage path upload APK tidak valid.");
  const { data, error } = await db.storage.from(APP_RELEASE_BUCKET).download(safePath);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length || buffer.length > APP_RELEASE_MAX_BYTES) throw new Error("Ukuran APK tidak valid atau terlalu besar.");
  return buffer;
}

async function verifyStoredApk(storagePath) {
  const buffer = await readStoredApk(storagePath);
  const metadata = inspectApk(buffer);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return { buffer, metadata, fileSizeBytes: buffer.length, sha256 };
}

async function removeStorageObject(storagePath) {
  if (!storagePath) return;
  try { await db.storage.from(APP_RELEASE_BUCKET).remove([storagePath]); } catch (error) { console.warn("[APP RELEASE CLEANUP ERROR]", error?.message || error); }
}





/* =========================================================
   SUPABASE AUTH
========================================================= */

/* =========================================================
   PORTAL ACCESS TOKEN GATE
========================================================= */

const PORTAL_ACCESS_EXEMPT_PATHS = new Set([
  "/api/access/status",
  "/api/access/contact-owner",
  "/api/access/verify",
]);

function normalizePortalToken(value) {
  return String(value || "").trim().replace(/[-\s]/g, "").toUpperCase();
}

function hashPortalToken(value) {
  const token = normalizePortalToken(value);
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

const PORTAL_TOKEN_PREFIX = "JYYR";
const PORTAL_TOKEN_HEX_LENGTH = 8;
const PORTAL_TOKEN_LENGTH = PORTAL_TOKEN_PREFIX.length + PORTAL_TOKEN_HEX_LENGTH;

function isCanonicalPortalToken(value) {
  return new RegExp(`^${PORTAL_TOKEN_PREFIX}[A-F0-9]{${PORTAL_TOKEN_HEX_LENGTH}}$`).test(String(value || "").trim().toUpperCase());
}

function generatePortalToken() {
  // Canonical owner token format is exactly 12 characters: JYYR + 8 uppercase hex characters.
  // 4 random bytes provide exactly 8 hex characters; uniqueness is enforced by the stored token hash.
  const token = `${PORTAL_TOKEN_PREFIX}${crypto.randomBytes(PORTAL_TOKEN_HEX_LENGTH / 2).toString("hex").toUpperCase()}`;
  if (token.length !== PORTAL_TOKEN_LENGTH || !isCanonicalPortalToken(token)) {
    throw new Error("Generated portal token violates the canonical 12-character format.");
  }
  return token;
}

function normalizePortalTokenDuration(value) {
  const mode = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PORTAL_TOKEN_GENERATION_MODES, mode) ? mode : null;
}

function getPortalTokenDurationLabel(durationMode) {
  const mode = normalizePortalTokenDuration(durationMode);
  return mode ? PORTAL_TOKEN_GENERATION_MODES[mode].label : "Legacy";
}

async function getPortalTokenLifetime(userId) {
  // Canonical source: the RPC resolves this exact user's assigned token and current access grant.
  // The redemption window is not the user access lifetime.
  const { data, error } = await db.rpc("portal_get_token_lifetime", {
    p_user_id: userId,
  });
  if (error) throw error;
  return data?.token || null;
}

function getPortalTokenEncryptionKey() {
  const secret = String(SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (secret.length < 32) {
    const error = new Error("SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi dengan aman.");
    error.code = "PORTAL_TOKEN_ENCRYPTION_KEY_MISSING";
    error.status = 500;
    throw error;
  }
  return crypto.createHash("sha256").update(`JYYR-AM-PRESENT-PORTAL-TOKEN|${secret}`, "utf8").digest();
}

function encryptPortalToken(token) {
  const plaintext = normalizePortalToken(token);
  if (!plaintext) throw new Error("Portal token kosong.");
  const key = getPortalTokenEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

// Short-lived in-memory fallback for the token just generated.
// The database remains the durable source of truth via token_encrypted; this
// only bridges the immediate history render when an old schema/migration has
// not finished propagating yet.
const recentOwnerPortalTokens = new Map();
const RECENT_OWNER_TOKEN_TTL_MS = 5 * 60 * 1000;

function rememberRecentOwnerPortalToken(ownerUserId, tokenId, token, expiresAt) {
  if (!ownerUserId || !tokenId || !token) return;
  recentOwnerPortalTokens.set(`${ownerUserId}:${tokenId}`, {
    token: normalizePortalToken(token),
    expiresAt: Date.parse(expiresAt || '') || (Date.now() + RECENT_OWNER_TOKEN_TTL_MS),
    rememberedAt: Date.now(),
  });
}

function getRecentOwnerPortalToken(ownerUserId, tokenId) {
  const key = `${ownerUserId}:${tokenId}`;
  const entry = recentOwnerPortalTokens.get(key);
  if (!entry) return null;
  if (Date.now() - entry.rememberedAt > RECENT_OWNER_TOKEN_TTL_MS || Date.now() >= entry.expiresAt) {
    recentOwnerPortalTokens.delete(key);
    return null;
  }
  return entry.token;
}

function decryptPortalToken(encrypted) {
  const parts = String(encrypted || "").split(".");
  if (parts.length !== 3) throw new Error("Portal token terenkripsi tidak valid.");
  try {
    const key = getPortalTokenEncryptionKey();
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error("Portal token terenkripsi tidak valid.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return normalizePortalToken(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch {
    const error = new Error("Portal token tidak dapat dibuka secara aman.");
    error.code = "PORTAL_TOKEN_DECRYPT_FAILED";
    error.status = 500;
    throw error;
  }
}

function isPortalAccessExempt(req) {
  if (PORTAL_ACCESS_EXEMPT_PATHS.has(req.path)) return true;
  if (req.path.startsWith("/api/owner/")) return true;
  return false;
}

async function hasPortalAccess(userId) {
  const { data, error } = await db.rpc("portal_has_access", { p_user_id: userId });
  if (error) {
    console.error("[PORTAL ACCESS CHECK ERROR]", { code: error.code || null, message: error.message || "Unknown error" });
    return false;
  }
  return data === true;
}

async function getMemberStatus(userId) {
  const { data, error } = await db.from("member_profiles")
    .select("status,status_reason,suspended_at,banned_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[MEMBER STATUS CHECK ERROR]", { code: error.code || null, message: error.message || "Unknown error" });
    throw error;
  }
  return data || { status: "active", status_reason: null, suspended_at: null, banned_at: null };
}

function restrictedMemberResponse(res, status) {
  const banned = status.status === "banned";
  return res.status(403).json({
    ok: false,
    code: banned ? "MEMBER_BANNED" : "MEMBER_SUSPENDED",
    status: status.status,
    reason: status.status_reason || null,
    error: banned ? "Akun Anda telah dibanned oleh Owner." : "Akun Anda sedang disuspend oleh Owner.",
  });
}

const requireAuth = createRequireAuth({
  supabase,
  isPortalAccessExempt,
  getMemberStatus,
  restrictedMemberResponse,
  isOwner,
  hasPortalAccess,
  getMaintenanceSettings,
});


/* =========================================================
   OWNER ENDPOINT RATE LIMITERS
========================================================= */


/* =========================================================
   OWNER AUTHORIZATION
========================================================= */

let maintenanceCache = { value: null, expiresAt: 0 };

async function getMaintenanceSettings() {
  const now = Date.now();
  if (maintenanceCache.expiresAt > now && maintenanceCache.value) return maintenanceCache.value;
  const { data, error } = await db.rpc("public_get_maintenance");
  if (error) throw error;
  const value = {
    maintenance_enabled: data?.maintenance_enabled === true,
    maintenance_message: String(data?.maintenance_message || "Jyy'R Amprem Sedang Maintenance"),
  };
  maintenanceCache = { value, expiresAt: now + 2000 };
  return value;
}

function invalidateMaintenanceCache() {
  maintenanceCache = { value: null, expiresAt: 0 };
}

async function assertMaintenanceOff() {
  const maintenance = await getMaintenanceSettings();
  if (maintenance.maintenance_enabled) {
    const error = new Error(maintenance.maintenance_message || "Website sedang maintenance.");
    error.code = "MAINTENANCE_MODE";
    error.status = 503;
    throw error;
  }
}

async function isOwner(userId) {
  if (!userId) return false;

  const { data, error } = await db.rpc(
    "is_owner",
    {
      p_user_id: userId,
    }
  );

  if (error) {
    console.error("[OWNER CHECK ERROR]", error);
    return false;
  }

  return data === true;
}

const requireOwner = createRequireOwner({ isOwner });

/* =========================================================
   PROVIDER DIAGNOSTIC INGESTION

   This endpoint is for provider-side instrumentation only. It never
   accepts mailbox credentials. The provider boundary is intentionally
   independent of mailbox credentials.
========================================================= */

function timingSafeSecretEquals(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided), "utf8");
  const b = Buffer.from(String(expected), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}



/* =========================================================
   INITIAL OWNER CLAIM
========================================================= */


/* =========================================================
   OWNER STATUS
========================================================= */


/* =========================================================
   PORTAL ACCESS TOKEN API
========================================================= */




/* =========================================================
   OWNER PORTAL TOKEN MANAGEMENT
========================================================= */





/* =========================================================
   OWNER MEMBER MANAGEMENT
========================================================= */


function memberErrorStatus(error) {
  const message = String(error?.message || "");
  if (/Owner access required/i.test(message)) return 403;
  if (/Member not found/i.test(message)) return 404;
  if (/Invalid|too long|cannot be suspended|cannot be banned/i.test(message)) return 400;
  return 500;
}



async function updateMemberProfile(req, res) {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Member ID tidak valid." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const displayName = body.display_name === null ? null : typeof body.display_name === "string" ? body.display_name : undefined;
    const notes = body.notes === null ? null : typeof body.notes === "string" ? body.notes : undefined;
    if (displayName === undefined && notes === undefined) return res.status(400).json({ ok: false, error: "Tidak ada perubahan yang dikirim." });
    if (displayName !== undefined && displayName.length > 100) return res.status(400).json({ ok: false, error: "Display name terlalu panjang." });
    if (notes !== undefined && notes.length > 2000) return res.status(400).json({ ok: false, error: "Notes terlalu panjang." });
    const { data: current, error: getError } = await db.rpc("owner_get_member", { p_owner_user_id: req.user.id, p_user_id: req.params.id });
    if (getError) throw getError;
    const { data, error } = await db.rpc("owner_update_member_profile", {
      p_owner_user_id: req.user.id, p_user_id: req.params.id,
      p_display_name: displayName === undefined ? current.display_name : displayName,
      p_notes: notes === undefined ? current.notes : notes,
    });
    if (error) throw error;
    return res.json({ ok: true, owner: true, member: data });
  } catch (error) {
    console.error("[OWNER MEMBER UPDATE ERROR]", error);
    const status = memberErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal memperbarui member." : error.message });
  }
}




async function setMemberStatus(req, res, forcedStatus) {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Member ID tidak valid." });
    const reason = req.body?.reason === undefined || req.body?.reason === null ? null : req.body.reason;
    if (reason !== null && typeof reason !== "string") return res.status(400).json({ ok: false, error: "Reason tidak valid." });
    if (reason && reason.length > 500) return res.status(400).json({ ok: false, error: "Reason terlalu panjang." });
    const { data, error } = await db.rpc("owner_set_member_status", {
      p_owner_user_id: req.user.id, p_user_id: req.params.id, p_new_status: forcedStatus, p_reason: reason,
    });
    if (error) throw error;

    // Also enforce the decision in Supabase Auth itself. This immediately
    // prevents login/refresh for suspended/banned accounts instead of waiting
    // for the app-level JWT gate. Unban clears the Auth ban.
    const banDuration = forcedStatus === "active" ? "none" : "876000h";
    const { error: authError } = await supabase.auth.admin.updateUserById(req.params.id, {
      ban_duration: banDuration,
    });
    if (authError) {
      console.error("[OWNER MEMBER AUTH STATUS ERROR]", { code: authError.code || null, message: authError.message || "Unknown error" });
      return res.status(502).json({ ok: false, error: "Status database berhasil diubah, tetapi enforcement Auth gagal. Coba ulangi aksi." });
    }

    return res.json({ ok: true, owner: true, member: data, auth_enforced: true });
  } catch (error) {
    console.error("[OWNER MEMBER STATUS ERROR]", error);
    const status = memberErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal mengubah status member." : error.message });
  }
}


/* =========================================================
   OWNER BROADCAST MANAGEMENT
========================================================= */

function broadcastErrorStatus(error) {
  const message = String(error?.message || "");
  if (/Owner access required/i.test(message)) return 403;
  if (/Broadcast not found/i.test(message)) return 404;
  if (/Invalid|requires|future|Only draft|Only draft, cancelled/i.test(message)) return 400;
  return 500;
}

function parseBroadcastDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}






/* =========================================================
   OWNER MESSAGING MANAGEMENT
========================================================= */

function messagingErrorStatus(error) {
  const message = String(error?.message || "");
  if (/Owner access required/i.test(message)) return 403;
  if (/Conversation not found|Member not found/i.test(message)) return 404;
  if (/Invalid|too long|closed/i.test(message)) return 400;
  return 500;
}






/* =========================================================
   OWNER FAQ / HELP / LOGIN ACTIVITY / MAINTENANCE
========================================================= */
function ownerCrudError(error) {
  const m=String(error?.message||"");
  if (/Owner access required/i.test(m)) return 403;
  if (/not found/i.test(m)) return 404;
  if (/duplicate|unique|invalid|too long|between|slug/i.test(m)) return 400;
  return 500;
}





/* =========================================================
   PUBLIC HELP / FAQ
========================================================= */


/* =========================================================
   MEMBER-SIDE NOTIFICATIONS / MESSAGING
========================================================= */


/* =========================================================
   OWNER STATISTICS / HEALTH
========================================================= */

async function fetchOwnerGenerationStatistics(userId) {
  const { data, error } = await db.rpc(
    "owner_generation_statistics",
    { p_user_id: userId }
  );

  if (error) throw error;
  return data || { today: 0, week: 0, month: 0, sevenDays: [] };
}



/* =========================================================
   RATE LIMIT
========================================================= */


/* =========================================================
   UTILITY
========================================================= */


/* =========================================================
   PROVIDER CONTRACT / RESPONSE SAFETY
========================================================= */

async function readResponseTextLimited(response, maxBytes) {
  if (!response?.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      const error = new Error("Provider response terlalu besar.");
      error.code = "PROVIDER_RESPONSE_TOO_LARGE";
      error.status = 502;
      throw error;
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        const error = new Error("Provider response terlalu besar.");
        error.code = "PROVIDER_RESPONSE_TOO_LARGE";
        error.status = 502;
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { await reader.releaseLock(); } catch {}
  }

  return Buffer.concat(chunks).toString("utf8");
}

/* =========================================================
   PROVIDER DUAL-FLOW HELPERS
========================================================= */

function sanitizeProviderDiagnosticString(value, maxLength = 300) {
  if (value === null || value === undefined) return null;
  let text = typeof value === "string" ? value : String(value);
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, "[URL_REDACTED]");
  text = text.replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[JWT_REDACTED]");
  text = text.replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[TOKEN_REDACTED]");
  text = text.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[EMAIL_REDACTED]");
  return text.slice(0, maxLength);
}

function extractProviderSafeError(data, status) {
  const candidates = [
    data?.error,
    data?.errors,
    data?.message,
    data?.reason,
    data?.detail,
    data?.code,
    data?.error?.message,
    data?.error?.reason,
    data?.error?.code,
    data?.data?.error,
    data?.data?.message,
    data?.data?.reason,
    data?.data?.code,
    data?.result?.error,
    data?.result?.message,
    data?.result?.reason,
    data?.result?.code,
  ];

  let code = null;
  let message = null;
  let reason = null;

  for (const value of candidates) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      code ??= sanitizeProviderDiagnosticString(value.code, 128);
      message ??= sanitizeProviderDiagnosticString(value.message || value.error, 300);
      reason ??= sanitizeProviderDiagnosticString(value.reason || value.status, 160);
      continue;
    }

    const safe = sanitizeProviderDiagnosticString(value, 300);
    if (!safe) continue;
    if (!message && typeof value === "string" && /error|fail|invalid|required|missing|not|verify|account|email|token|action/i.test(value)) {
      message = safe;
    } else if (!code && typeof value === "string" && /^[A-Z0-9_.:-]{2,128}$/i.test(value)) {
      code = safe.slice(0, 128);
    }
  }

  return {
    status: Number.isInteger(status) ? status : null,
    code,
    message,
    reason,
    responseKeys: data && typeof data === "object" && !Array.isArray(data)
      ? Object.keys(data).slice(0, 40)
      : [],
  };
}

async function callProviderVerifyAccount({ providerBase, providerKey, email, rawLink }) {
  const url = new URL(PROVIDER_VERIFY_ACCOUNT_PATH, providerBase);
  const body = { email: String(email).trim(), rawLink: String(rawLink).trim() };
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    console.log("[PROVIDER DIAGNOSTIC] verify_account_request_start", { host: url.hostname, path: url.pathname, hasEmail: Boolean(body.email), hasRawLink: Boolean(body.rawLink) });
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": providerKey }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await readResponseTextLimited(response, PROVIDER_MAX_RESPONSE_BYTES);
    let data; try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 2000) }; }
    const elapsedMs = Date.now() - startedAt;
    const validObject = data && typeof data === "object" && !Array.isArray(data);
    const providerSuccess = response.ok && validObject && data.success === true;
    const verified = extractProviderVerified(data);
    const providerEmail = extractProviderEmail(data).value;
    const idToken = extractProviderIdToken(data);
    const providerError = extractProviderSafeError(data, response.status);
    console.log("[PROVIDER DIAGNOSTIC] verify_account_response_received", { status: response.status, ok: response.ok, elapsedMs, providerSuccess, verified, hasIdToken: Boolean(idToken), providerEmailDomain: providerEmail ? providerEmail.split("@").pop() : null, codeOrder: data?.codeOrder || data?.codeorder || null, providerError });
    let reason = null;
    if (!providerSuccess) reason = response.ok ? "PROVIDER_CONTRACT_FAILED" : "HTTP_ERROR";
    else if (verified !== true) reason = verified === false ? "EMAIL_NOT_VERIFIED" : "VERIFICATION_STATUS_MISSING";
    else if (!idToken) reason = "ID_TOKEN_MISSING";
    return { attempted: true, ok: providerSuccess && verified === true && Boolean(idToken), status: response.status, elapsedMs, data, providerSuccess, verified, providerEmail, idToken, providerError, reason };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const reason = error?.name === "AbortError" ? "TIMEOUT" : "REQUEST_ERROR";
    console.error("[PROVIDER DIAGNOSTIC] verify_account_request_error", { reason, message: error?.message || "Unknown error", elapsedMs });
    return { attempted: true, ok: false, status: null, elapsedMs, data: null, providerSuccess: false, verified: null, providerEmail: null, idToken: null, providerError: null, reason };
  } finally { clearTimeout(timeout); }
}


function extractProviderCodeOrder(data) {
  const candidates = [
    data?.codeOrder, data?.codeorder,
    data?.data?.codeOrder, data?.data?.codeorder,
    data?.result?.codeOrder, data?.result?.codeorder,
  ];
  for (const value of candidates) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim().slice(0, 160);
  }
  return null;
}

async function callProviderSendMagicLink({ providerBase, providerKey, email }) {
  if (!PROVIDER_SEND_MAGICLINK_ENABLED) {
    return {
      enabled: false,
      attempted: false,
      ok: false,
      status: null,
      elapsedMs: 0,
      data: null,
      reason: "DISABLED",
    };
  }

  const url = new URL(PROVIDER_SEND_MAGICLINK_PATH, providerBase);
  const body = { email: String(email).trim() };

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    console.log("[PROVIDER DIAGNOSTIC] send_magiclink_request_start", {
      host: url.hostname,
      path: url.pathname,
      hasEmail: Boolean(body.email),
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": providerKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await readResponseTextLimited(response, PROVIDER_MAX_RESPONSE_BYTES);
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw: raw.slice(0, 2000) };
    }

    const elapsedMs = Date.now() - startedAt;
    const validObject = data && typeof data === "object" && !Array.isArray(data);
    const providerAccepted = response.ok && validObject && data.success === true;
    const codeOrder = extractProviderCodeOrder(data);

    console.log("[PROVIDER DIAGNOSTIC] send_magiclink_response_received", {
      status: response.status,
      ok: response.ok,
      elapsedMs,
      providerAccepted,
      deliveryChannel: "email_mailbox",
      deliveryStatus: providerAccepted ? "provider_accepted_not_delivery_confirmed" : "not_accepted",
      magicLinkRequiredFrom: "mailbox_or_user_input",
      magicLinkIncludedInResponse: false,
      codeOrder,
      contract: "SEND_MAGICLINK_ACCEPTANCE_ONLY",
    });

    return {
      enabled: true,
      attempted: true,
      ok: providerAccepted,
      status: response.status,
      elapsedMs,
      data,
      deliveryAccepted: providerAccepted,
      deliveryStatus: providerAccepted ? "provider_accepted" : "failed",
      deliveryConfirmed: false,
      codeOrder,
      reason: providerAccepted ? null : response.ok ? "PROVIDER_CONTRACT_FAILED" : "HTTP_ERROR",
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const reason = error?.name === "AbortError" ? "TIMEOUT" : "REQUEST_ERROR";
    console.error("[PROVIDER DIAGNOSTIC] send_magiclink_request_error", {
      reason,
      message: error?.message || "Unknown error",
      elapsedMs,
    });
    return {
      enabled: true,
      attempted: true,
      ok: false,
      status: null,
      elapsedMs,
      data: null,
      reason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callProviderApplyPremium({ providerBase, providerKey, email, idToken }) {
  const url = new URL(PROVIDER_APPLY_PREMIUM_PATH, providerBase);
  const body = { email: String(email).trim(), idToken: String(idToken).trim() };
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    console.log("[PROVIDER DIAGNOSTIC] apply_premium_request_start", { host: url.hostname, path: url.pathname, hasEmail: Boolean(body.email), hasIdToken: Boolean(body.idToken) });
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": providerKey }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await readResponseTextLimited(response, PROVIDER_MAX_RESPONSE_BYTES);
    let data; try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 2000) }; }
    const elapsedMs = Date.now() - startedAt;
    const providerResult = data?.data?.result ?? data?.data?.data?.result ?? data?.result ?? null;
    const returnedEmail = extractProviderEmail(data).value;
    const success = response.ok && data?.success === true && providerResult?.status === "success" && providerResult?.valid === true;
    console.log("[PROVIDER DIAGNOSTIC] apply_premium_response_received", { status: response.status, ok: response.ok, elapsedMs, providerSuccess: data?.success === true, premiumStatus: providerResult?.status || null, premiumValid: providerResult?.valid === true, returnedEmailDomain: returnedEmail ? returnedEmail.split("@").pop() : null, codeOrder: data?.data?.codeorder || data?.data?.codeOrder || data?.codeOrder || null, providerError: extractProviderSafeError(data, response.status) });
    return { attempted: true, ok: success, status: response.status, elapsedMs, data, providerResult, returnedEmail, providerError: extractProviderSafeError(data, response.status), reason: success ? null : response.ok ? "PREMIUM_CONTRACT_FAILED" : "HTTP_ERROR" };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const reason = error?.name === "AbortError" ? "TIMEOUT" : "REQUEST_ERROR";
    console.error("[PROVIDER DIAGNOSTIC] apply_premium_request_error", { reason, message: error?.message || "Unknown error", elapsedMs });
    return { attempted: true, ok: false, status: null, elapsedMs, data: null, providerResult: null, returnedEmail: null, providerError: null, reason };
  } finally { clearTimeout(timeout); }
}


/* =========================================================
   PROVIDER RESPONSE SANITIZER
========================================================= */

function sanitizeProviderResponse(data) {
  if (!data || typeof data !== "object") {
    return {};
  }

  const pick = (source, keys) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
    const out = {};
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        out[key] = source[key];
      }
    }
    return Object.keys(out).length ? out : undefined;
  };

  const result = {};
  const topLevel = pick(data, [
    "email",
    "message",
    "error",
    "status",
    "success",
    "codeOrder",
  ]);

  if (topLevel) Object.assign(result, topLevel);

  const account = pick(data.account, [
    "email",
    "status",
  ]);
  if (account) result.account = account;

  const dataBlock = pick(data.data, [
    "email",
    "message",
    "error",
    "status",
    "success",
    "codeOrder",
  ]);
  if (dataBlock) result.data = dataBlock;

  const premiumSource =
    data?.premium?.result ??
    data?.premium?.data?.result ??
    data?.premium;

  const premium = pick(premiumSource, [
    "status",
    "valid",
    "expiryTimeMillis",
    "codeorder",
  ]);
  if (premium) result.premium = premium;

  return result;
}


/* =========================================================
   PROVIDER DELIVERY WEBHOOK

   Optional: when the provider can emit a delivery event, it may call this
   endpoint. The portal never treats provider acceptance (HTTP 200/success)
   as proof of inbox delivery.
========================================================= */

function normalizeDeliveryState(value) {
  const state = String(value || "").trim().toLowerCase();
  if (["delivered", "delivery_confirmed", "received", "success"].includes(state)) return "delivery_confirmed";
  if (["failed", "bounced", "rejected", "undelivered"].includes(state)) return "delivery_failed";
  return null;
}


/* =========================================================
   ERROR RESPONSE
========================================================= */


/* =========================================================
   HEALTH
========================================================= */


/* =========================================================
   ACCOUNT HISTORY
========================================================= */





/* =========================================================
   DAILY USAGE — PER USER
========================================================= */


/* =========================================================
   IDEMPOTENCY + PROVIDER QUOTA
========================================================= */

function normalizeIdempotencyKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length > 128) return null;
  return raw;
}

function hashIdempotencyKey(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function claimGenerationRequest(userId, idempotencyKey) {
  const { data, error } = await db.rpc("claim_generation_request", {
    p_user_id: userId,
    p_idempotency_hash: hashIdempotencyKey(idempotencyKey),
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function finalizeGenerationRequest(userId, idempotencyKey, state, httpStatus, responseBody) {
  const { error } = await db.rpc("finalize_generation_request", {
    p_user_id: userId,
    p_idempotency_hash: hashIdempotencyKey(idempotencyKey),
    p_state: state,
    p_http_status: httpStatus,
    p_response_body: responseBody || {},
  });
  if (error) console.error("[IDEMPOTENCY FINALIZE ERROR]", error);
}

async function reserveProviderRequest(usageDate, endpoint) {
  const { data, error } = await db.rpc("reserve_provider_api_request", {
    p_usage_date: usageDate,
    p_endpoint: endpoint,
    p_daily_limit: PROVIDER_DAILY_REQUEST_LIMIT,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function recordProviderRequestResult(usageDate, endpoint, success) {
  const { error } = await db.rpc("record_provider_api_result", {
    p_usage_date: usageDate,
    p_endpoint: endpoint,
    p_success: Boolean(success),
  });
  if (error) console.error("[PROVIDER QUOTA RESULT ERROR]", error);
}

async function consumeMagicLinkQuota(userId, accountId, usageDate, dailyLimit, source) {
  const { data, error } = await db.rpc("consume_magic_link_quota", {
    p_user_id: userId,
    p_account_id: accountId,
    p_usage_date: usageDate,
    p_daily_limit: dailyLimit,
    p_source: source,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/* =========================================================
   MAGIC LINK DELIVERY STATUS
========================================================= */


/* =========================================================
   RESEND MAGIC LINK
========================================================= */



/* =========================================================
   GENERATE
========================================================= */



async function sendSignupVerificationEmail(email) {
  assertEmailVerificationConfig();
  const { error } = await supabaseAuth.auth.resend({ type: "signup", email: email });
  if (!error) return;
  const wrapped = new Error(error.message || "Supabase Auth OTP email gagal dikirim.");
  wrapped.code = error.code || "AUTH_EMAIL_SEND_FAILED";
  wrapped.status = Number(error.status) || 503;
  wrapped.retryAfter = Number(error.retryAfter || 0);
  throw wrapped;
}


/* =========================================================
   INTERNAL MAINTENANCE
========================================================= */

/* =========================================================
   PWA ROOT ASSETS
   Keep installability URLs stable at the site root. The files are
   mirrored into /public so express.static also serves them directly.
========================================================= */





/* =========================================================
   AUTH PAGES
========================================================= */



/* =========================================================
   OWNER PAGE
========================================================= */





const runtime={
  db,
  env,
  envHttpUrl,
  getProviderTokenEncryptionKey,
  encryptProviderIdToken,
  decryptProviderIdToken,
  normalizeUserEmail,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_PUBLISHABLE_KEY,
  AUTH_EMAIL_VERIFICATION_TTL_MINUTES,
  AUTH_EMAIL_RESEND_COOLDOWN_SECONDS,
  MAGIC_LINK_DAILY_LIMIT,
  FINAL_MAGIC_FLOW,
  supabase,
  assertEmailVerificationConfig,
  verificationRequestHash,
  supabaseAuth,
  publicUser,
  findPendingEmailVerification,
  semverParts,
  TOKEN_CENTER_URL,
  ECOSYSTEM_HANDOFF_SECRET,
  OWNER_WHATSAPP_URL,
  APP_RELEASE_PACKAGE,
  APP_RELEASE_BUCKET,
  APP_RELEASE_MAX_BYTES,
  releaseDownloadUrl,
  readStoredApk,
  verifyStoredApk,
  removeStorageObject,
  PORTAL_ACCESS_EXEMPT_PATHS,
  PORTAL_TOKEN_PREFIX,
  PORTAL_TOKEN_HEX_LENGTH,
  PORTAL_TOKEN_LENGTH,
  isCanonicalPortalToken,
  normalizePortalToken,
  hashPortalToken,
  generatePortalToken,
  normalizePortalTokenDuration,
  getPortalTokenDurationLabel,
  getPortalTokenLifetime,
  getPortalTokenEncryptionKey,
  encryptPortalToken,
  recentOwnerPortalTokens,
  RECENT_OWNER_TOKEN_TTL_MS,
  rememberRecentOwnerPortalToken,
  getRecentOwnerPortalToken,
  decryptPortalToken,
  isPortalAccessExempt,
  hasPortalAccess,
  getMemberStatus,
  restrictedMemberResponse,
  requireAuth,
  isOwner,
  getMaintenanceSettings,
  invalidateMaintenanceCache,
  assertMaintenanceOff,
  requireOwner,
  timingSafeSecretEquals,
  parsePositiveInt,
  isUuid,
  memberErrorStatus,
  updateMemberProfile,
  setMemberStatus,
  broadcastErrorStatus,
  parseBroadcastDate,
  messagingErrorStatus,
  ownerCrudError,
  fetchOwnerGenerationStatistics,
  todayUTC,
  safeNumber,
  readResponseTextLimited,
  sanitizeProviderDiagnosticString,
  extractProviderSafeError,
  callProviderVerifyAccount,
  extractProviderCodeOrder,
  callProviderSendMagicLink,
  callProviderApplyPremium,
  sanitizeProviderResponse,
  normalizeDeliveryState,
  publicError,
  normalizeIdempotencyKey,
  hashIdempotencyKey,
  claimGenerationRequest,
  finalizeGenerationRequest,
  reserveProviderRequest,
  recordProviderRequestResult,
  consumeMagicLinkQuota,
  sendSignupVerificationEmail,
};
export default runtime;
export { db, env, envHttpUrl, getProviderTokenEncryptionKey, encryptProviderIdToken, decryptProviderIdToken, normalizeUserEmail, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY, AUTH_EMAIL_VERIFICATION_TTL_MINUTES, AUTH_EMAIL_RESEND_COOLDOWN_SECONDS, MAGIC_LINK_DAILY_LIMIT, FINAL_MAGIC_FLOW, supabase, assertEmailVerificationConfig, verificationRequestHash, supabaseAuth, publicUser, findPendingEmailVerification, semverParts, TOKEN_CENTER_URL, ECOSYSTEM_HANDOFF_SECRET, APP_RELEASE_PACKAGE, APP_RELEASE_BUCKET, APP_RELEASE_MAX_BYTES, releaseDownloadUrl, readStoredApk, verifyStoredApk, removeStorageObject, PORTAL_ACCESS_EXEMPT_PATHS, PORTAL_TOKEN_PREFIX, PORTAL_TOKEN_HEX_LENGTH, PORTAL_TOKEN_LENGTH, isCanonicalPortalToken, normalizePortalToken, hashPortalToken, generatePortalToken, normalizePortalTokenDuration, getPortalTokenDurationLabel, getPortalTokenLifetime, getPortalTokenEncryptionKey, encryptPortalToken, recentOwnerPortalTokens, RECENT_OWNER_TOKEN_TTL_MS, rememberRecentOwnerPortalToken, getRecentOwnerPortalToken, decryptPortalToken, isPortalAccessExempt, hasPortalAccess, getMemberStatus, restrictedMemberResponse, requireAuth, isOwner, getMaintenanceSettings, invalidateMaintenanceCache, assertMaintenanceOff, requireOwner, timingSafeSecretEquals, parsePositiveInt, isUuid, memberErrorStatus, updateMemberProfile, setMemberStatus, broadcastErrorStatus, parseBroadcastDate, messagingErrorStatus, ownerCrudError, fetchOwnerGenerationStatistics, todayUTC, safeNumber, readResponseTextLimited, sanitizeProviderDiagnosticString, extractProviderSafeError, callProviderVerifyAccount, extractProviderCodeOrder, callProviderSendMagicLink, callProviderApplyPremium, sanitizeProviderResponse, normalizeDeliveryState, publicError, normalizeIdempotencyKey, hashIdempotencyKey, claimGenerationRequest, finalizeGenerationRequest, reserveProviderRequest, recordProviderRequestResult, consumeMagicLinkQuota, sendSignupVerificationEmail };
