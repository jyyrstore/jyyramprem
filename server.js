
import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  decodeJwtPayloadSafe,
  extractProviderEmail,
} from "./lib/provider-contract.js";
import {
  normalizeProviderDiagnosticEvent,
  providerDiagnosticPublicError,
} from "./lib/provider-diagnostic-contract.js";
import { normalizeMagicLink } from "./lib/magiclink-contract.js";
import { extractProviderVerified, extractProviderIdToken } from "./lib/provider-verification-contract.js";
import { inspectApk } from "./lib/apk-manifest.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MAGIC_LINK_DAILY_LIMIT = Number(process.env.MAGIC_LINK_DAILY_LIMIT || process.env.DAILY_LOCAL_LIMIT || 5);
const PROVIDER_DAILY_REQUEST_LIMIT = Number(process.env.PROVIDER_DAILY_REQUEST_LIMIT || 45);
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 30000);
const PROVIDER_MAX_RESPONSE_BYTES = Number(process.env.PROVIDER_MAX_RESPONSE_BYTES || 512 * 1024);
const PROVIDER_SEND_MAGICLINK_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.PROVIDER_SEND_MAGICLINK_ENABLED || "true"));
const PROVIDER_SEND_MAGICLINK_PATH = process.env.PROVIDER_SEND_MAGICLINK_PATH || "/api/v1/send-magiclink";
const PROVIDER_VERIFY_ACCOUNT_PATH = process.env.PROVIDER_VERIFY_ACCOUNT_PATH || "/api/v1/verify-account";
const PROVIDER_APPLY_PREMIUM_PATH = process.env.PROVIDER_APPLY_PREMIUM_PATH || "/api/v1/apply-premium";
const PROVIDER_DIAGNOSTIC_SECRET = process.env.PROVIDER_DIAGNOSTIC_SECRET?.trim() || "";
const PROVIDER_DELIVERY_WEBHOOK_ENABLED = Boolean(PROVIDER_DIAGNOSTIC_SECRET);
const PORTAL_TOKEN_TTL_HOURS = Number(process.env.PORTAL_TOKEN_TTL_HOURS || 24);
const PORTAL_TOKEN_GENERATION_MODES = Object.freeze({
  "15_days": { label: "15 Hari", days: 15 },
  "30_days": { label: "30 Hari", days: 30 },
  permanent: { label: "Permanent", days: null },
});
const OWNER_WHATSAPP_URL = String(process.env.OWNER_WHATSAPP_URL || "").trim();
const PROVIDER_TOKEN_ENCRYPTION_KEY = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY?.trim() || "";

if (PROVIDER_TOKEN_ENCRYPTION_KEY && PROVIDER_TOKEN_ENCRYPTION_KEY.length < 32) {
  throw new Error("PROVIDER_TOKEN_ENCRYPTION_KEY harus minimal 32 karakter jika dikonfigurasi.");
}

if (!Number.isInteger(MAGIC_LINK_DAILY_LIMIT) || MAGIC_LINK_DAILY_LIMIT < 1) throw new Error("MAGIC_LINK_DAILY_LIMIT harus berupa integer >= 1.");
if (!Number.isInteger(PROVIDER_DAILY_REQUEST_LIMIT) || PROVIDER_DAILY_REQUEST_LIMIT < 1) throw new Error("PROVIDER_DAILY_REQUEST_LIMIT harus berupa integer >= 1.");
if (!Number.isInteger(PROVIDER_TIMEOUT_MS) || PROVIDER_TIMEOUT_MS < 1000) throw new Error("PROVIDER_TIMEOUT_MS harus berupa integer >= 1000.");
if (!Number.isInteger(PROVIDER_MAX_RESPONSE_BYTES) || PROVIDER_MAX_RESPONSE_BYTES < 1024 || PROVIDER_MAX_RESPONSE_BYTES > 10 * 1024 * 1024) throw new Error("PROVIDER_MAX_RESPONSE_BYTES harus integer 1024..10485760.");
if (!Number.isInteger(PORTAL_TOKEN_TTL_HOURS) || PORTAL_TOKEN_TTL_HOURS < 1 || PORTAL_TOKEN_TTL_HOURS > 720) throw new Error("PORTAL_TOKEN_TTL_HOURS harus integer 1..720.");
if (!PROVIDER_SEND_MAGICLINK_PATH.startsWith("/api/v1/")) throw new Error("PROVIDER_SEND_MAGICLINK_PATH harus endpoint V1.");
if (!PROVIDER_VERIFY_ACCOUNT_PATH.startsWith("/api/v1/")) throw new Error("PROVIDER_VERIFY_ACCOUNT_PATH harus endpoint V1.");
if (!PROVIDER_APPLY_PREMIUM_PATH.startsWith("/api/v1/")) throw new Error("PROVIDER_APPLY_PREMIUM_PATH harus endpoint V1.");

/* =========================================================
   BASIC CONFIG
========================================================= */

app.disable("x-powered-by");

// Baseline security headers. Keep CSP out of this layer because the
// frontend currently uses inline scripts and external Supabase assets.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (process.env.NODE_ENV === "production" && (req.secure || forwardedProto === "https")) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
});

app.use(
  express.json({
    limit: "32kb",
  })
);

app.use((req, res, next) => {
  // HTML/API responses must always revalidate so UI deployments do not stay stale.
  if (req.path.endsWith(".html") || req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }
  next();
});

app.use(
  express.static(
    path.join(__dirname, "public"),
    {
      index: false,
      setHeaders: (res, filePath) => {
        if (/\.(?:css|js)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (/\.(?:svg|png|jpe?g|webp|woff2?|ttf|otf)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=86400, must-revalidate");
        }
      },
    }
  )
);

/* =========================================================
   ENV
========================================================= */

function env(name) {
  const value = process.env[name]?.trim();
  const placeholder = /^(YOUR_|REPLACE_WITH_|CHANGE_ME|PASTE_|GANTI_)/i.test(value || "");

  if (
    !value ||
    placeholder ||
    value === "undefined" ||
    value === "null"
  ) {
    throw new Error(
      `${name} belum dikonfigurasi dengan nilai nyata.`
    );
  }

  return value;
}

function envHttpUrl(name) {
  let value = env(name);

  // Common Termux/.env typo: a hostname was supplied without a scheme.
  // Normalize only a bare hostname; never silently repair malformed schemes.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && /^[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(value)) {
    value = `https://${value}`;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${name} harus berupa URL HTTP/HTTPS yang valid. Contoh: https://jfjbdenqepaagxfysaar.supabase.co`
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${name} harus menggunakan http:// atau https://. Nilai diterima: ${value}`
    );
  }

  if (!parsed.hostname) {
    throw new Error(`${name} tidak memiliki hostname yang valid.`);
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";

  return parsed.toString().replace(/\/$/, "");
}

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
   SUPABASE
========================================================= */

const SUPABASE_URL =
  envHttpUrl("SUPABASE_URL");

const SUPABASE_SERVICE_ROLE_KEY =
  env("SUPABASE_SERVICE_ROLE_KEY");

const SUPABASE_PUBLISHABLE_KEY =
  env("SUPABASE_PUBLISHABLE_KEY");

const AUTH_EMAIL_VERIFICATION_TTL_MINUTES = Math.max(5, Number(process.env.AUTH_EMAIL_VERIFICATION_TTL_MINUTES || 30));
const AUTH_EMAIL_RESEND_COOLDOWN_SECONDS = Math.max(15, Number(process.env.AUTH_EMAIL_RESEND_COOLDOWN_SECONDS || 60));

/* FINAL_TARGET_FLOW
 * Registration is free of application cooldown. Email verification uses a
 * 6-digit code delivered to the user's own mailbox. Resend is throttled.
 * After email verification, the existing portal-token owner gate applies.
 */
const FINAL_MAGIC_FLOW = Object.freeze({
  flowMode: "signup_email_code_then_owner_token",
  signupCooldown: 0,
  emailVerificationCode: true,
  emailVerificationTtlMinutes: AUTH_EMAIL_VERIFICATION_TTL_MINUTES,
  resendCooldownSeconds: AUTH_EMAIL_RESEND_COOLDOWN_SECONDS,
  requireOwnerTokenBeforePortal: true,
  providerPremiumFlowPreserved: true,
});

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

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

const supabaseAuth = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);


function publicUser(data) {
  return data ? { id: data.id, email: data.email, email_confirmed_at: data.email_confirmed_at || null, user_metadata: data.user_metadata || {} } : null;
}

async function findAuthUserByEmail(email) {
  const target = String(email || "").toLowerCase();
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = Array.isArray(data?.users) ? data.users : [];
    const found = users.find((u) => String(u.email || "").toLowerCase() === target);
    if (found) return found;
    if (users.length < 1000) break;
  }
  return null;
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const parsed = normalizeUserEmail(req.body?.email);
    if (!parsed.valid) return res.status(400).json({ ok: false, code: "INVALID_EMAIL", error: "Masukkan alamat email yang valid." });
    const email = parsed.value;
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(422).json({ ok: false, code: "WEAK_PASSWORD", error: "Password minimal 8 karakter." });
    assertEmailVerificationConfig();

    const metadata = (req.body?.data && typeof req.body.data === "object") ? req.body.data : {};

    const existingUser = await findAuthUserByEmail(email);
    if (existingUser) {
      if (existingUser.email_confirmed_at) {
        return res.status(409).json({
          ok: false,
          code: "EMAIL_EXISTS",
          error: "Email sudah terdaftar. Silakan masuk.",
        });
      }

      return res.status(409).json({
        ok: false,
        code: "EMAIL_PENDING_VERIFICATION",
        stage: "pending_email",
        user: publicUser(existingUser),
        email,
        error: "Email sudah digunakan tetapi belum terverifikasi. Masukkan code 6 digit atau kirim ulang code.",
      });
    }

    const { data: signupData, error: signupError } = await supabaseAuth.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });
    if (signupError) {
      const message = String(signupError.message || "");
      const duplicate = /already.*registered|already.*exists|duplicate/i.test(message);
      return res.status(duplicate ? 409 : Number(signupError.status) || 400).json({
        ok: false,
        code: duplicate ? "EMAIL_EXISTS" : "SIGNUP_FAILED",
        error: duplicate ? "Email sudah terdaftar. Silakan masuk." : message,
      });
    }

    const user = signupData?.user;
    if (!user?.id) {
      return res.status(502).json({ ok: false, code: "SIGNUP_USER_MISSING", error: "Registrasi dibuat tanpa data akun yang valid." });
    }

    const requestHash = verificationRequestHash(user.id);
    await supabase.from("am_email_verifications").delete().eq("user_id", user.id).is("used_at", null);
    const { error: insertError } = await supabase.from("am_email_verifications").insert({
      user_id: user.id,
      email,
      token_hash: requestHash,
      expires_at: new Date(Date.now() + AUTH_EMAIL_VERIFICATION_TTL_MINUTES * 60000).toISOString(),
    });
    if (insertError) throw insertError;

    return res.status(201).json({
      ok: true,
      stage: "pending_email",
      user: publicUser(user),
      email,
      session: null,
      resendAvailableAt: new Date(Date.now() + AUTH_EMAIL_RESEND_COOLDOWN_SECONDS * 1000).toISOString(),
    });
  } catch (error) {
    console.error("[AUTH REGISTER ERROR]", error);
    return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_REGISTER_FAILED", error: error.status ? error.message : "Registrasi gagal. Coba lagi." });
  }
});



app.post("/api/auth/resend-verification", async (req, res) => {
  try {
    const parsed = normalizeUserEmail(req.body?.email);
    if (!parsed.valid) return res.status(400).json({ ok: false, code: "INVALID_EMAIL", error: "Masukkan alamat email yang valid." });
    assertEmailVerificationConfig();
    const email = parsed.value;
    const user = await findAuthUserByEmail(email);
    if (!user) return res.status(404).json({ ok: false, code: "USER_NOT_FOUND", error: "Akun dengan email tersebut belum terdaftar." });
    if (user.email_confirmed_at) return res.status(409).json({ ok: false, code: "ALREADY_VERIFIED", error: "Email sudah terverifikasi. Silakan masuk." });

    const { data: recent } = await supabase.from("am_email_verifications").select("created_at,expires_at,used_at").eq("user_id", user.id).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const retryAt = recent?.created_at ? new Date(new Date(recent.created_at).getTime() + AUTH_EMAIL_RESEND_COOLDOWN_SECONDS * 1000) : null;
    if (retryAt && retryAt.getTime() > Date.now()) {
      const retryAfter = Math.ceil((retryAt.getTime() - Date.now()) / 1000);
      return res.status(429).json({ ok: false, code: "RESEND_COOLDOWN", retryAfter, error: `Tunggu ${retryAfter} detik sebelum mengirim ulang code.` });
    }

    const requestHash = verificationRequestHash(user.id);
    await supabase.from("am_email_verifications").delete().eq("user_id", user.id).is("used_at", null);
    const { error: insertError } = await supabase.from("am_email_verifications").insert({
      user_id: user.id,
      email,
      token_hash: requestHash,
      expires_at: new Date(Date.now() + AUTH_EMAIL_VERIFICATION_TTL_MINUTES * 60000).toISOString(),
    });
    if (insertError) throw insertError;
    try {
      await sendSignupVerificationEmail(email);
    } catch (mailError) {
      await supabase.from("am_email_verifications").delete().eq("user_id", user.id).is("used_at", null);
      throw mailError;
    }
    return res.json({ ok: true, email, resendAvailableAt: new Date(Date.now() + AUTH_EMAIL_RESEND_COOLDOWN_SECONDS * 1000).toISOString() });
  } catch (error) {
    console.error("[AUTH RESEND ERROR]", error);
    return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_RESEND_FAILED", retryAfter: Number(error.retryAfter || 0), error: error.status ? error.message : "Tidak dapat mengirim code verifikasi." });
  }
});

app.post("/api/auth/verify-email", async (req, res) => {
  try {
    const parsed = normalizeUserEmail(req.body?.email);
    if (!parsed.valid) return res.status(400).json({ ok: false, code: "INVALID_EMAIL", error: "Email tidak valid." });
    const code = String(req.body?.code || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, code: "INVALID_CODE", error: "Masukkan 6 digit code verifikasi." });
    const email = parsed.value;
    const user = await findAuthUserByEmail(email);
    if (!user) return res.status(404).json({ ok: false, code: "USER_NOT_FOUND", error: "Akun tidak ditemukan." });
    if (user.email_confirmed_at) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: String(req.body?.password || "") });
      if (!error && data?.session) return res.json({ ok: true, stage: "email_verified", ...data });
      return res.status(409).json({ ok: false, code: "ALREADY_VERIFIED", error: "Email sudah terverifikasi. Silakan masuk." });
    }
    const { data: row, error: rowError } = await supabase.from("am_email_verifications").select("id,expires_at,used_at,attempt_count").eq("user_id", user.id).eq("email", email).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (rowError) throw rowError;
    if (!row || row.expires_at <= new Date().toISOString()) return res.status(410).json({ ok: false, code: "CODE_EXPIRED", error: "Code verifikasi sudah kedaluwarsa. Kirim ulang code baru." });

    const { data: otpData, error: otpError } = await supabaseAuth.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (otpError || !otpData?.session) {
      const nextAttempts = Number(row.attempt_count || 0) + 1;
      await supabase.from("am_email_verifications").update({ attempt_count: nextAttempts }).eq("id", row.id);
      if (nextAttempts >= 5) {
        await supabase.from("am_email_verifications").delete().eq("id", row.id);
        return res.status(429).json({ ok: false, code: "CODE_ATTEMPTS_EXCEEDED", error: "Terlalu banyak percobaan. Kirim ulang code verifikasi baru." });
      }
      return res.status(401).json({ ok: false, code: "INVALID_CODE", error: otpError?.message || "Code verifikasi salah." });
    }

    const { data: confirmedUser, error: updateError } = await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
    if (updateError) throw updateError;
    const updated = confirmedUser || { user: user };
    await supabase.from("am_email_verifications").update({ used_at: new Date().toISOString() }).eq("id", row.id);

    // verifyOtp() already returns the authenticated Supabase session. Reuse it
    // directly so registration does not force the user through a second
    // email+password login before the Portal Token gate.
    return res.json({ ok: true, stage: "email_verified", user: publicUser(updated.user), ...otpData });
  } catch (error) {
    console.error("[AUTH VERIFY ERROR]", error);
    return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_VERIFY_FAILED", error: error.status ? error.message : "Verifikasi email gagal." });
  }
});

app.get(
  "/api/config",
  (_req, res) => {
    return res.json({
      ok: true,
      supabaseUrl:
        SUPABASE_URL,
      supabasePublishableKey:
        SUPABASE_PUBLISHABLE_KEY,
    });
  }
);

/* =========================================================
   APP RELEASE / DISTRIBUTION
========================================================= */

function semverParts(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemver(a, b) {
  const aa = semverParts(a) || [0, 0, 0];
  const bb = semverParts(b) || [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return 0;
}

function normalizeReleaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/releases/")) return raw;
  const url = new URL(raw, SUPABASE_URL);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL download tidak valid.");
  return url.toString();
}

app.get("/app", (_req, res) => res.redirect(302, "/app.html"));

app.get("/api/app/latest", async (req, res) => {
  try {
    const channel = String(req.query?.channel || "stable").trim().toLowerCase();
    if (!["stable", "beta"].includes(channel)) return res.status(400).json({ ok: false, error: "Channel tidak valid." });
    const { data, error } = await supabase.from("app_releases")
      .select("id,app_key,platform,version,version_code,title,changelog,download_url,file_name,file_size_bytes,sha256,package_name,min_sdk,target_sdk,min_supported_version,mandatory_update,release_channel,status,published_at,created_at,updated_at")
      .eq("app_key", "jyyramprem").eq("platform", "android").eq("release_channel", channel).eq("status", "published")
      .order("version_code", { ascending: false }).order("published_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, code: "NO_RELEASE", error: "Belum ada release tersedia." });
    return res.set("Cache-Control", "no-store, max-age=0").json({ ok: true, release: data });
  } catch (error) {
    console.error("[APP LATEST ERROR]", error);
    return res.status(500).json({ ok: false, error: "Gagal membaca release aplikasi." });
  }
});

app.get("/api/app/releases", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query?.limit || "20", 10) || 20, 1), 50);
    const channel = String(req.query?.channel || "stable").trim().toLowerCase();
    if (!["stable", "beta"].includes(channel)) return res.status(400).json({ ok: false, error: "Channel tidak valid." });
    const { data, error } = await supabase.from("app_releases")
      .select("id,app_key,platform,version,version_code,title,changelog,download_url,file_name,file_size_bytes,sha256,package_name,min_sdk,target_sdk,min_supported_version,mandatory_update,release_channel,status,published_at,created_at,updated_at")
      .eq("app_key", "jyyramprem").eq("platform", "android").eq("release_channel", channel).eq("status", "published")
      .order("version_code", { ascending: false }).order("published_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return res.set("Cache-Control", "no-store, max-age=0").json({ ok: true, releases: data || [] });
  } catch (error) {
    console.error("[APP RELEASES ERROR]", error);
    return res.status(500).json({ ok: false, error: "Gagal membaca riwayat release aplikasi." });
  }
});

const ownerBroadcastReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Batas request Broadcast tercapai. Coba lagi nanti." },
});

const ownerMemberMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Batas perubahan Member tercapai. Coba lagi nanti." },
});


const APP_RELEASE_PACKAGE = "com.jyystore.jyyramprem";
const APP_RELEASE_BUCKET = "app-releases";
const APP_RELEASE_MAX_BYTES = 512 * 1024 * 1024;

function releaseDownloadUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${APP_RELEASE_BUCKET}/${storagePath}`;
}

async function readStoredApk(storagePath) {
  const safePath = String(storagePath || "").trim();
  if (!/^incoming\/[0-9a-f-]{36}\.apk$/i.test(safePath)) throw new Error("Storage path upload APK tidak valid.");
  const { data, error } = await supabase.storage.from(APP_RELEASE_BUCKET).download(safePath);
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
  try { await supabase.storage.from(APP_RELEASE_BUCKET).remove([storagePath]); } catch (error) { console.warn("[APP RELEASE CLEANUP ERROR]", error?.message || error); }
}

app.post("/api/owner/app-releases/sign-upload", requireAuth, ownerMemberMutationLimiter, requireOwner, async (_req, res) => {
  try {
    const path = `incoming/${crypto.randomUUID()}.apk`;
    const { data, error } = await supabase.storage.from(APP_RELEASE_BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;
    return res.json({ ok: true, upload: { path, token: data.token, signedUrl: data.signedUrl, contentType: "application/vnd.android.package-archive" } });
  } catch (error) {
    console.error("[APP RELEASE SIGN UPLOAD ERROR]", error);
    return res.status(500).json({ ok: false, error: "Gagal menyiapkan upload APK." });
  }
});

app.get("/api/owner/app-releases", requireAuth, ownerBroadcastReadLimiter, requireOwner, async (_req, res) => {
  try {
    const { data, error } = await supabase.from("app_releases").select("*").eq("app_key", "jyyramprem").eq("platform", "android").order("version_code", { ascending: false }).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return res.json({ ok: true, owner: true, releases: data || [] });
  } catch (error) {
    console.error("[OWNER APP RELEASES ERROR]", error);
    return res.status(500).json({ ok: false, error: "Gagal membaca release aplikasi." });
  }
});

app.post("/api/owner/app-releases", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
  let incomingPath = "";
  try {
    const b = req.body || {};
    incomingPath = String(b.storage_path || "").trim();
    try { incomingPath = decodeURIComponent(incomingPath); } catch {}
    if (!/^incoming\/[0-9a-f-]{36}\.apk$/i.test(incomingPath)) return res.status(400).json({ ok: false, error: "Upload APK belum diterima Storage. Ulangi proses upload dari awal." });

    const verified = await verifyStoredApk(incomingPath);
    const m = verified.metadata;
    if (m.packageName !== APP_RELEASE_PACKAGE) return res.status(400).json({ ok: false, error: `Package Name APK tidak sesuai. Wajib ${APP_RELEASE_PACKAGE}.` });
    if (!semverParts(m.versionName)) return res.status(400).json({ ok: false, error: "versionName APK harus mengikuti format X.Y.Z." });

    const { data: existing, error: existingError } = await supabase.from("app_releases")
      .select("id,version,version_code,status,release_channel")
      .eq("app_key", "jyyramprem").eq("platform", "android")
      .or(`version.eq.${m.versionName},version_code.eq.${m.versionCode}`);
    if (existingError) throw existingError;
    if (existing?.length) return res.status(409).json({ ok: false, error: `Release v${m.versionName} / code ${m.versionCode} sudah ada. Gunakan Edit untuk mengubah metadata release yang existing.` });

    const channel = "stable";
    const statusValue = "published";
    const { data: latestStable, error: latestStableError } = await supabase.from("app_releases")
      .select("version,version_code").eq("app_key", "jyyramprem").eq("platform", "android")
      .eq("release_channel", channel).eq("status", "published")
      .order("version_code", { ascending: false }).limit(1).maybeSingle();
    if (latestStableError) throw latestStableError;
    if (latestStable && m.versionCode <= Number(latestStable.version_code || 0)) {
      return res.status(409).json({ ok: false, error: `Version Code APK harus lebih besar dari release stable terbaru (${latestStable.version_code}).` });
    }
    const { data: firstStable, error: firstStableError } = await supabase.from("app_releases")
      .select("version,version_code,published_at").eq("app_key", "jyyramprem").eq("platform", "android").eq("release_channel", "stable").eq("status", "published")
      .order("version_code", { ascending: true }).order("published_at", { ascending: true }).limit(1).maybeSingle();
    if (firstStableError) throw firstStableError;
    const minSupportedVersion = String(b.min_supported_version || "").trim() || firstStable?.version || m.versionName;
    if (!semverParts(minSupportedVersion)) return res.status(400).json({ ok: false, error: "Minimum Version tidak valid." });

    const canonicalPath = `android/${m.versionName}/JyyR-Amprem-${m.versionName}.apk`;
    const { error: uploadError } = await supabase.storage.from(APP_RELEASE_BUCKET).upload(canonicalPath, verified.buffer, {
      contentType: "application/vnd.android.package-archive", cacheControl: "31536000", upsert: false,
    });
    if (uploadError) throw uploadError;

    const changelog = Array.isArray(b.changelog) ? b.changelog.map((x) => String(x).trim()).filter(Boolean).slice(0, 30) : [];
    const payload = {
      app_key: "jyyramprem", platform: "android", version: m.versionName, version_code: m.versionCode,
      title: "Jyy'R Amprem", changelog, download_url: releaseDownloadUrl(canonicalPath), storage_path: canonicalPath,
      file_name: `JyyR-Amprem-${m.versionName}.apk`, file_size_bytes: verified.fileSizeBytes, sha256: verified.sha256,
      package_name: m.packageName, min_sdk: m.minSdk, target_sdk: m.targetSdk,
      min_supported_version: minSupportedVersion, mandatory_update: false, release_channel: channel,
      status: statusValue, published_at: new Date().toISOString(), created_by: req.user.id,
    };
    const { data, error } = await supabase.from("app_releases").insert(payload).select("*").single();
    if (error) { await removeStorageObject(canonicalPath); throw error; }
    await removeStorageObject(incomingPath);
    incomingPath = "";
    return res.status(201).json({ ok: true, owner: true, release: data, verified: { package_name: m.packageName, version: m.versionName, version_code: m.versionCode, file_size_bytes: verified.fileSizeBytes, sha256: verified.sha256, min_sdk: m.minSdk, target_sdk: m.targetSdk } });
  } catch (error) {
    await removeStorageObject(incomingPath);
    console.error("[OWNER APP RELEASE CREATE ERROR]", error);
    const duplicate = /duplicate key|unique constraint/i.test(String(error.message));
    return res.status(duplicate ? 409 : 500).json({ ok: false, error: duplicate ? "Release version atau version code tersebut sudah ada." : "APK gagal diverifikasi atau release gagal dibuat." });
  }
});

app.patch("/api/owner/app-releases/:id", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Release ID tidak valid." });
    const b = req.body || {};
    const patch = {};
    for (const key of ["title","min_supported_version"]) if (b[key] !== undefined) patch[key] = String(b[key] || "").trim() || null;
    if (b.changelog !== undefined) patch.changelog = Array.isArray(b.changelog) ? b.changelog.map((x) => String(x).trim()).filter(Boolean).slice(0,30) : [];
    if (b.mandatory_update !== undefined) patch.mandatory_update = Boolean(b.mandatory_update);
    if (b.status !== undefined) patch.status = ["draft","published","archived"].includes(String(b.status)) ? String(b.status) : undefined;
    if (b.release_channel !== undefined) patch.release_channel = ["stable","beta"].includes(String(b.release_channel)) ? String(b.release_channel) : undefined;
    if (b.status === "published") patch.published_at = new Date().toISOString();
    if (patch.min_supported_version && !semverParts(patch.min_supported_version)) return res.status(400).json({ ok: false, error: "Minimum version tidak valid." });
    if (Object.keys(patch).some((key) => patch[key] === undefined)) return res.status(400).json({ ok: false, error: "Metadata release tidak valid." });
    const { data, error } = await supabase.from("app_releases").update(patch).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    return res.json({ ok: true, owner: true, release: data });
  } catch (error) {
    console.error("[OWNER APP RELEASE UPDATE ERROR]", error);
    const duplicate = /duplicate key|unique constraint/i.test(String(error.message));
    return res.status(duplicate ? 409 : 500).json({ ok: false, error: duplicate ? "Perubahan release melanggar aturan unik database." : "Gagal memperbarui release aplikasi." });
  }
});

/* =========================================================
   SUPABASE AUTH
========================================================= */

/* =========================================================
   PORTAL ACCESS TOKEN GATE
========================================================= */

const PORTAL_ACCESS_EXEMPT_PATHS = new Set([
  "/api/access/status",
  "/api/access/request",
  "/api/access/verify",
]);

function normalizePortalToken(value) {
  return String(value || "").trim().replace(/[-\s]/g, "").toUpperCase();
}

function hashPortalToken(value) {
  const token = normalizePortalToken(value);
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function generatePortalToken() {
  return crypto.randomBytes(10).toString("hex").toUpperCase();
}

function normalizePortalTokenDuration(value) {
  const mode = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PORTAL_TOKEN_GENERATION_MODES, mode) ? mode : null;
}

function getPortalTokenExpiration(durationMode) {
  const mode = normalizePortalTokenDuration(durationMode);
  if (!mode) throw Object.assign(new Error("Mode token tidak valid."), { code: "INVALID_PORTAL_TOKEN_MODE", status: 400 });
  const config = PORTAL_TOKEN_GENERATION_MODES[mode];
  if (config.days === null) return null;
  return new Date(Date.now() + config.days * 24 * 60 * 60 * 1000).toISOString();
}

function getPortalTokenDurationLabel(durationMode) {
  const mode = normalizePortalTokenDuration(durationMode);
  return mode ? PORTAL_TOKEN_GENERATION_MODES[mode].label : "Legacy";
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
    expiresAt: Date.parse(expiresAt || '') || (Date.now() + PORTAL_TOKEN_TTL_HOURS * 60 * 60 * 1000),
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
  const { data, error } = await supabase.rpc("portal_has_access", { p_user_id: userId });
  if (error) {
    console.error("[PORTAL ACCESS CHECK ERROR]", { code: error.code || null, message: error.message || "Unknown error" });
    return false;
  }
  return data === true;
}

async function getMemberStatus(userId) {
  const { data, error } = await supabase
    .from("member_profiles")
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

async function requireAuth(
  req,
  res,
  next
) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (
      !authorization.startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        ok: false,
        error:
          "Login diperlukan.",
      });
    }

    const token =
      authorization
        .slice(7)
        .trim();

    if (!token) {
      return res.status(401).json({
        ok: false,
        error:
          "Token autentikasi tidak ditemukan.",
      });
    }

    const {
      data: { user },
      error,
    } =
      await supabase.auth.getUser(
        token
      );

    if (error || !user) {
      return res.status(401).json({
        ok: false,
        error:
          "Session tidak valid atau sudah kedaluwarsa.",
      });
    }

    req.user = user;

    // Enforce the application member state at the authentication boundary.
    // This makes Suspend/Ban effective for every authenticated member API route,
    // including requests made with an already-issued JWT. Owner is exempt.
    if (!isPortalAccessExempt(req)) {
      const memberStatus = await getMemberStatus(user.id);
      if (memberStatus.status === "suspended" || memberStatus.status === "banned") {
        return restrictedMemberResponse(res, memberStatus);
      }
    }

    // Owner access is intrinsic: an authenticated Owner must never be blocked by
    // the member portal-token gate. Keep the explicit owner flag on req so the
    // authorization decision is visible to downstream middleware and regression tests.
    if (!isPortalAccessExempt(req)) {
      const owner = await isOwner(user.id);
      req.isOwner = owner;

      if (!owner) {
        const access = await hasPortalAccess(user.id);
        if (!access) {
          return res.status(403).json({
            ok: false,
            code: "PORTAL_TOKEN_REQUIRED",
            error: "Token akses portal diperlukan.",
          });
        }
      }
    }

    return next();
  } catch (error) {
    console.error(
      "[AUTH ERROR]",
      error
    );

    return res.status(401).json({
      ok: false,
      error:
        "Autentikasi gagal.",
    });
  }
}

const portalTokenRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Terlalu banyak request token. Coba lagi nanti." },
});

const portalTokenVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Terlalu banyak percobaan token. Coba lagi nanti." },
});

/* =========================================================
   OWNER ENDPOINT RATE LIMITERS
========================================================= */

const ownerClaimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Batas percobaan Owner tercapai. Coba lagi nanti." },
});

const ownerReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Batas request Owner tercapai. Coba lagi nanti." },
});

const ownerStatisticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Batas request statistik Owner tercapai. Coba lagi nanti." },
});

const ownerMemberReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Batas request Member Management tercapai. Coba lagi nanti." },
});

const ownerBroadcastMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : "unauthenticated",
  message: { ok: false, error: "Batas perubahan Broadcast tercapai. Coba lagi nanti." },
});

/* =========================================================
   OWNER AUTHORIZATION
========================================================= */

async function isOwner(userId) {
  if (!userId) return false;

  const { data, error } = await supabase.rpc(
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

async function requireOwner(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        ok: false,
        error: "Login diperlukan.",
      });
    }

    const owner = await isOwner(req.user.id);

    if (!owner) {
      return res.status(403).json({
        ok: false,
        error: "Akses Owner diperlukan.",
      });
    }

    req.isOwner = true;
    return next();
  } catch (error) {
    console.error("[OWNER AUTH ERROR]", error);

    return res.status(500).json({
      ok: false,
      error: "Gagal memeriksa akses Owner.",
    });
  }
}

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

const providerDiagnosticLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || "unknown",
  message: { ok: false, error: "Batas diagnostic provider tercapai." },
});

app.post(
  "/api/internal/provider/diagnostic",
  providerDiagnosticLimiter,
  (req, res) => {
    if (!PROVIDER_DIAGNOSTIC_SECRET) {
      return res.status(404).json({ ok: false, error: "Endpoint diagnostic tidak diaktifkan." });
    }

    const provided = req.get("x-provider-diagnostic-secret") || "";
    if (!timingSafeSecretEquals(provided, PROVIDER_DIAGNOSTIC_SECRET)) {
      console.warn("[PROVIDER DIAGNOSTIC AUTH FAILED]", {
        ip: req.ip || null,
        userAgent: String(req.get("user-agent") || "").slice(0, 160),
      });
      return res.status(401).json({ ok: false, error: "Diagnostic authentication failed." });
    }

    try {
      const event = normalizeProviderDiagnosticEvent(req.body);
      console.log("[PROVIDER DIAGNOSTIC EVENT]", JSON.stringify(event));
      return res.status(202).json({
        ok: true,
        accepted: true,
        schemaVersion: event.schemaVersion,
        eventId: event.eventId,
        requestId: event.requestId,
        stage: event.stage,
      });
    } catch (error) {
      const safe = providerDiagnosticPublicError(error);
      console.warn("[PROVIDER DIAGNOSTIC REJECTED]", {
        error: safe.body.error,
        details: Array.isArray(error?.details) ? error.details : undefined,
      });
      return res.status(safe.status).json(safe.body);
    }
  }
);

/* =========================================================
   INITIAL OWNER CLAIM
========================================================= */

app.post(
  "/api/owner/claim",
  requireAuth,
  ownerClaimLimiter,
  async (req, res) => {
    try {
      const { data, error } =
        await supabase.rpc(
          "claim_initial_owner",
          {
            p_user_id: req.user.id,
          }
        );

      if (error) {
        console.error(
          "[OWNER CLAIM ERROR]",
          error
        );

        return res.status(500).json({
          ok: false,
          owner: false,
          error:
            "Gagal mengambil status Owner.",
        });
      }

      if (data !== true) {
        return res.status(403).json({
          ok: false,
          owner: false,
          error:
            "Owner sudah diklaim oleh akun lain.",
        });
      }

      return res.json({
        ok: true,
        owner: true,
        message:
          "Akun berhasil menjadi Owner.",
      });
    } catch (error) {
      console.error(
        "[OWNER CLAIM ERROR]",
        error
      );

      return res.status(500).json({
        ok: false,
        owner: false,
        error:
          "Terjadi kesalahan saat claim Owner.",
      });
    }
  }
);

/* =========================================================
   OWNER STATUS
========================================================= */

app.get(
  "/api/owner/status",
  requireAuth,
  ownerReadLimiter,
  async (req, res) => {
    try {
      const owner = await isOwner(req.user.id);

      return res.json({
        ok: true,
        owner,
        user: {
          id: req.user.id,
          email: req.user.email || null,
          created_at: req.user.created_at || null,
          last_sign_in_at: req.user.last_sign_in_at || null,
        },
      });
    } catch (error) {
      console.error("[OWNER STATUS ERROR]", error);

      return res.status(500).json({
        ok: false,
        owner: false,
        error: "Gagal memeriksa status Owner.",
      });
    }
  }
);

/* =========================================================
   PORTAL ACCESS TOKEN API
========================================================= */

app.get("/api/access/status", requireAuth, async (req, res) => {
  try {
    const status = await getMemberStatus(req.user.id);
    const access = status.status === "active" && await hasPortalAccess(req.user.id);
    const owner = await isOwner(req.user.id);
    return res.json({ ok: true, access, owner, status: status.status, reason: status.status_reason || null });
  } catch (error) {
    console.error("[PORTAL ACCESS STATUS ERROR]", error);
    return res.status(500).json({ ok: false, access: false, error: "Gagal memeriksa akses portal." });
  }
});

app.post("/api/access/request", requireAuth, portalTokenRequestLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase.rpc("portal_request_token", { p_user_id: req.user.id });
    if (error) throw error;

    if (!OWNER_WHATSAPP_URL) {
      return res.status(503).json({ ok: false, request: data, error: "WhatsApp Owner belum dikonfigurasi di server." });
    }

    const message = `Halo Owner, saya meminta Token Akses Portal Jyy'R Amprem. Request ID: ${data.request_id}`;
    const url = new URL(OWNER_WHATSAPP_URL);
    url.searchParams.set("text", message);

    return res.status(201).json({ ok: true, request: data, whatsappUrl: url.toString() });
  } catch (error) {
    console.error("[PORTAL TOKEN REQUEST ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
    return res.status(500).json({ ok: false, error: "Gagal mencatat request token." });
  }
});

app.post("/api/access/verify", requireAuth, portalTokenVerifyLimiter, async (req, res) => {
  try {
    const token = normalizePortalToken(req.body?.token);
    if (!/^[A-F0-9]{20}$/.test(token)) return res.status(400).json({ ok: false, valid: false, error: "Format token tidak valid." });

    const { data, error } = await supabase.rpc("portal_verify_token", { p_user_id: req.user.id, p_token_hash: hashPortalToken(token) });
    if (error) {
      const invalid = /invalid|expired/i.test(String(error.message || ""));
      return res.status(invalid ? 401 : 500).json({ ok: false, valid: false, error: invalid ? "Token salah atau sudah kedaluwarsa." : "Gagal memverifikasi token." });
    }
    return res.json({ ok: true, valid: data?.valid === true, expiresAt: data?.expires_at || null });
  } catch (error) {
    console.error("[PORTAL TOKEN VERIFY ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
    return res.status(500).json({ ok: false, valid: false, error: "Gagal memverifikasi token." });
  }
});

/* =========================================================
   OWNER PORTAL TOKEN MANAGEMENT
========================================================= */

app.get("/api/owner/token/status", requireAuth, ownerReadLimiter, requireOwner, async (req, res) => {
  try {
    const { data, error } = await supabase.rpc("owner_get_portal_token_status", { p_owner_user_id: req.user.id });
    if (error) throw error;
    return res.json({ ok: true, owner: true, token: data });
  } catch (error) {
    return res.status(500).json({ ok: false, owner: true, error: "Gagal membaca status token." });
  }
});

app.get("/api/owner/token/requests", requireAuth, ownerReadLimiter, requireOwner, async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 20, 50);
    const offset = parsePositiveInt(req.query.offset, 0, 1000000);
    if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Pagination tidak valid." });
    const { data, error } = await supabase.rpc("owner_list_token_requests", { p_owner_user_id: req.user.id, p_limit: limit, p_offset: offset });
    if (error) throw error;
    return res.json({ ok: true, owner: true, ...data });
  } catch (error) {
    const status = /Owner access required/i.test(String(error?.message || "")) ? 403 : 500;
    return res.status(status).json({ ok: false, error: status === 403 ? "Akses Owner diperlukan." : "Gagal membaca request token." });
  }
});

app.post("/api/owner/token/generate", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
  try {
    const durationMode = normalizePortalTokenDuration(req.body?.duration_mode || req.body?.durationMode);
    if (!durationMode) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_PORTAL_TOKEN_MODE",
        error: "Mode token harus 15 hari, 30 hari, atau permanent.",
      });
    }
    const token = generatePortalToken();
    const expiresAt = getPortalTokenExpiration(durationMode);
    const tokenHash = hashPortalToken(token);
    const tokenPreview = `${token.slice(0, 4)}••••${token.slice(-4)}`;
    const tokenEncrypted = encryptPortalToken(token);

    // IMPORTANT: persist the full owner token directly through the trusted
    // server client. Do not rely on overloaded/legacy RPC signatures here;
    // several historical versions of owner_create_portal_token exist in
    // production and some of them silently omit token_encrypted.
    const { data, error } = await supabase
      .from("portal_access_tokens")
      .insert({
        token_hash: tokenHash,
        token_preview: tokenPreview,
        token_encrypted: tokenEncrypted,
        status: "active",
        duration_mode: durationMode,
        expires_at: expiresAt,
        created_by: req.user.id,
      })
      .select("id, created_at, expires_at, status, duration_mode, token_encrypted")
      .single();

    if (error) throw error;
    if (!data?.id) throw Object.assign(new Error("Token ID tidak dikembalikan database."), { code: "PORTAL_TOKEN_ID_MISSING", status: 500 });
    if (!data.token_encrypted) {
      throw Object.assign(new Error("Token terenkripsi tidak tersimpan di database."), { code: "PORTAL_TOKEN_ENCRYPTED_NOT_PERSISTED", status: 500 });
    }

    // Read-after-write verification. This catches a wrong database/schema
    // immediately instead of allowing a token that disappears after refresh.
    const { data: persisted, error: persistedError } = await supabase
      .from("portal_access_tokens")
      .select("id, token_encrypted, expires_at, duration_mode")
      .eq("id", data.id)
      .single();
    if (persistedError) throw persistedError;
    if (!persisted?.token_encrypted) {
      throw Object.assign(new Error("Token terenkripsi hilang setelah insert."), { code: "PORTAL_TOKEN_ENCRYPTED_READBACK_FAILED", status: 500 });
    }

    rememberRecentOwnerPortalToken(req.user.id, data.id, token, persisted.expires_at || data.expires_at || null);
    return res.status(201).json({
      ok: true,
      owner: true,
      token,
      tokenId: data.id,
      createdAt: data.created_at || new Date().toISOString(),
      expiresAt: persisted.expires_at ?? data.expires_at ?? null,
      durationMode: persisted.duration_mode || data.duration_mode || durationMode,
      durationLabel: getPortalTokenDurationLabel(persisted.duration_mode || data.duration_mode || durationMode),
    });
  } catch (error) {
    console.error("[OWNER TOKEN GENERATE ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
    return res.status(500).json({ ok: false, error: "Gagal membuat token." });
  }
});

app.get("/api/owner/token/history", requireAuth, ownerReadLimiter, requireOwner, async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const offset = parsePositiveInt(req.query.offset, 0, 1000000);
    if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Pagination tidak valid." });

    // Read directly from the trusted service-role client. This avoids the
    // historical owner_list_portal_tokens overloads that can omit the
    // encrypted field and cause a token to disappear after refresh.
    const { data: rows, error } = await supabase
      .from("portal_access_tokens")
      .select("id, token_preview, token_encrypted, duration_mode, status, created_at, expires_at, used_at, revoked_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const { count: total, error: countError } = await supabase
      .from("portal_access_tokens")
      .select("id", { count: "exact", head: true });
    if (countError) throw countError;

    // The token history UI needs the email of the member who actually used a
    // token. That relationship lives in portal_access_grants, while emails
    // live in Supabase Auth, so resolve only the users referenced by the
    // current page instead of loading the entire Auth user table.
    const tokenIds = (Array.isArray(rows) ? rows : []).map((row) => row.id).filter(Boolean);
    const usedEmailByTokenId = new Map();
    if (tokenIds.length) {
      const { data: grants, error: grantsError } = await supabase
        .from("portal_access_grants")
        .select("token_id, user_id")
        .in("token_id", tokenIds);
      if (grantsError) throw grantsError;

      const userIds = [...new Set((Array.isArray(grants) ? grants : []).map((grant) => grant.user_id).filter(Boolean))];
      const usersById = new Map();
      for (const userId of userIds) {
        try {
          const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
          if (!userError && userData?.user?.email) usersById.set(userId, userData.user.email);
        } catch (userError) {
          console.error("[OWNER TOKEN HISTORY USER LOOKUP ERROR]", { userId, message: userError?.message || "Unknown error" });
        }
      }

      for (const grant of Array.isArray(grants) ? grants : []) {
        const email = usersById.get(grant.user_id);
        if (email && !usedEmailByTokenId.has(grant.token_id)) usedEmailByTokenId.set(grant.token_id, email);
      }
    }

    const tokens = (Array.isArray(rows) ? rows : []).map((row) => {
      const safeRow = {
        id: row.id,
        preview: row.token_preview || null,
        duration_mode: row.duration_mode || "legacy",
        duration_label: getPortalTokenDurationLabel(row.duration_mode),
        status: row.status === "active" && row.expires_at && new Date(row.expires_at).getTime() <= Date.now() ? "expired" : row.status,
        created_at: row.created_at,
        expires_at: row.expires_at,
        used_at: row.used_at,
        revoked_at: row.revoked_at,
        used_email: usedEmailByTokenId.get(row.id) || null,
      };
      const encrypted = String(row.token_encrypted || "").trim();
      if (encrypted) {
        try {
          safeRow.token = decryptPortalToken(encrypted);
        } catch (decryptError) {
          console.error("[OWNER TOKEN HISTORY DECRYPT ERROR]", { code: decryptError?.code || null, tokenId: row.id });
          safeRow.token = getRecentOwnerPortalToken(req.user.id, row.id);
        }
      } else {
        safeRow.token = getRecentOwnerPortalToken(req.user.id, row.id);
      }
      // Owner history intentionally does not expose plaintext to the browser
      // when it cannot be recovered. The preview remains available as a safe
      // diagnostic for legacy rows.
      return safeRow;
    });

    return res.json({ ok: true, owner: true, tokens, total: Number(total) || 0, limit, offset });
  } catch (error) {
    const status = /Owner access required/i.test(String(error?.message || "")) ? 403 : 500;
    return res.status(status).json({ ok: false, error: status === 403 ? "Akses Owner diperlukan." : "Gagal membaca history token." });
  }
});

app.post("/api/owner/token/revoke", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
  try {
    if (!isUuid(req.body?.token_id)) return res.status(400).json({ ok: false, error: "Token ID tidak valid." });
    const { data, error } = await supabase.rpc("owner_revoke_portal_token", { p_owner_user_id: req.user.id, p_token_id: req.body.token_id });
    if (error) throw error;
    return res.json({ ok: true, owner: true, revoked: data === true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Gagal mencabut token." });
  }
});

/* =========================================================
   OWNER MEMBER MANAGEMENT
========================================================= */

function parsePositiveInt(value, fallback, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : null;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function memberErrorStatus(error) {
  const message = String(error?.message || "");
  if (/Owner access required/i.test(message)) return 403;
  if (/Member not found/i.test(message)) return 404;
  if (/Invalid|too long|cannot be suspended|cannot be banned/i.test(message)) return 400;
  return 500;
}

app.get(
  "/api/owner/members",
  requireAuth,
  ownerMemberReadLimiter,
  requireOwner,
  async (req, res) => {
    try {
      const limit = parsePositiveInt(req.query.limit, 20, 50);
      const offset = parsePositiveInt(req.query.offset, 0, 1000000);
      if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Parameter pagination tidak valid." });
      const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : null;
      const status = typeof req.query.status === "string" ? req.query.status.trim() : null;
      if (status && !["active", "suspended", "banned"].includes(status)) return res.status(400).json({ ok: false, error: "Filter status tidak valid." });

      const { data, error } = await supabase.rpc("owner_list_members", {
        p_owner_user_id: req.user.id, p_limit: limit, p_offset: offset,
        p_search: search || null, p_status: status || null,
      });
      if (error) throw error;
      return res.json({ ok: true, owner: true, ...data });
    } catch (error) {
      console.error("[OWNER MEMBERS LIST ERROR]", error);
      return res.status(memberErrorStatus(error)).json({ ok: false, error: memberErrorStatus(error) === 500 ? "Gagal membaca member." : error.message });
    }
  }
);

app.get(
  "/api/owner/members/:id",
  requireAuth,
  ownerMemberReadLimiter,
  requireOwner,
  async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Member ID tidak valid." });
      const { data, error } = await supabase.rpc("owner_get_member", { p_owner_user_id: req.user.id, p_user_id: req.params.id });
      if (error) throw error;
      return res.json({ ok: true, owner: true, member: data });
    } catch (error) {
      console.error("[OWNER MEMBER GET ERROR]", error);
      const status = memberErrorStatus(error);
      return res.status(status).json({ ok: false, error: status === 500 ? "Gagal membaca member." : error.message });
    }
  }
);

async function updateMemberProfile(req, res) {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Member ID tidak valid." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const displayName = body.display_name === null ? null : typeof body.display_name === "string" ? body.display_name : undefined;
    const notes = body.notes === null ? null : typeof body.notes === "string" ? body.notes : undefined;
    if (displayName === undefined && notes === undefined) return res.status(400).json({ ok: false, error: "Tidak ada perubahan yang dikirim." });
    if (displayName !== undefined && displayName.length > 100) return res.status(400).json({ ok: false, error: "Display name terlalu panjang." });
    if (notes !== undefined && notes.length > 2000) return res.status(400).json({ ok: false, error: "Notes terlalu panjang." });
    const { data: current, error: getError } = await supabase.rpc("owner_get_member", { p_owner_user_id: req.user.id, p_user_id: req.params.id });
    if (getError) throw getError;
    const { data, error } = await supabase.rpc("owner_update_member_profile", {
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

app.patch("/api/owner/members/:id", requireAuth, ownerMemberMutationLimiter, requireOwner, updateMemberProfile);


app.delete("/api/owner/members/:id", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
  try {
    const userId = String(req.params.id || "").trim();
    if (!isUuid(userId)) {
      return res.status(400).json({ ok: false, error: "Member ID tidak valid." });
    }

    // Never allow the Owner account itself to be deleted through member management.
    if (userId === req.user.id) {
      return res.status(400).json({ ok: false, error: "Akun Owner tidak dapat dihapus dari Member Management." });
    }

    const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(userId);
    if (targetError) throw targetError;
    const target = targetData?.user;
    if (!target) {
      return res.status(404).json({ ok: false, error: "Akun member tidak ditemukan." });
    }

    /*
     * Some historical project tables intentionally use ON DELETE RESTRICT for
     * audit/owner-message references. Clean only the target member's dependent
     * records first, then let Supabase Auth perform the canonical user delete.
     * All writes use the service-role client and therefore remain server-side.
     */
    const { error: deleteMessagesError } = await supabase
      .from("owner_messages")
      .delete()
      .or(`sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`);
    if (deleteMessagesError) throw deleteMessagesError;

    const { error: deleteConversationsError } = await supabase
      .from("owner_conversations")
      .delete()
      .eq("member_user_id", userId);
    if (deleteConversationsError) throw deleteConversationsError;

    const { error: deleteStatusEventsError } = await supabase
      .from("member_status_events")
      .delete()
      .eq("changed_by", userId);
    if (deleteStatusEventsError) throw deleteStatusEventsError;

    const { error: deleteTokenAuditError } = await supabase
      .from("portal_access_tokens")
      .delete()
      .eq("created_by", userId);
    if (deleteTokenAuditError) throw deleteTokenAuditError;

    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId, false);
    if (deleteError) throw deleteError;

    console.info("[OWNER MEMBER DELETE]", {
      ownerUserId: req.user.id,
      deletedUserId: userId,
    });

    return res.json({
      ok: true,
      owner: true,
      deleted: true,
      user_id: userId,
      email: target.email || null,
    });
  } catch (error) {
    console.error("[OWNER MEMBER DELETE ERROR]", {
      code: error?.code || null,
      message: error?.message || "Unknown error",
    });
    const message = String(error?.message || "");
    if (/Owner access required/i.test(message)) {
      return res.status(403).json({ ok: false, error: "Akses Owner diperlukan." });
    }
    if (/User not found|not found/i.test(message)) {
      return res.status(404).json({ ok: false, error: "Akun member tidak ditemukan." });
    }
    return res.status(500).json({ ok: false, error: "Gagal menghapus akun member." });
  }
});

async function setMemberStatus(req, res, forcedStatus) {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Member ID tidak valid." });
    const reason = req.body?.reason === undefined || req.body?.reason === null ? null : req.body.reason;
    if (reason !== null && typeof reason !== "string") return res.status(400).json({ ok: false, error: "Reason tidak valid." });
    if (reason && reason.length > 500) return res.status(400).json({ ok: false, error: "Reason terlalu panjang." });
    const { data, error } = await supabase.rpc("owner_set_member_status", {
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

app.post("/api/owner/members/:id/suspend", requireAuth, ownerMemberMutationLimiter, requireOwner, (req, res) => setMemberStatus(req, res, "suspended"));
app.post("/api/owner/members/:id/ban", requireAuth, ownerMemberMutationLimiter, requireOwner, (req, res) => setMemberStatus(req, res, "banned"));
app.post("/api/owner/members/:id/unban", requireAuth, ownerMemberMutationLimiter, requireOwner, (req, res) => setMemberStatus(req, res, "active"));

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

app.get("/api/owner/broadcasts", requireAuth, ownerBroadcastReadLimiter, requireOwner, async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 20, 50);
    const offset = parsePositiveInt(req.query.offset, 0, 1000000);
    if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Parameter pagination tidak valid." });
    const { data, error } = await supabase.rpc("owner_list_broadcasts", {
      p_owner_user_id: req.user.id, p_limit: limit, p_offset: offset,
    });
    if (error) throw error;
    return res.json({ ok: true, owner: true, ...data });
  } catch (error) {
    console.error("[OWNER BROADCAST LIST ERROR]", error);
    const status = broadcastErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal membaca broadcast." : error.message });
  }
});

app.get("/api/owner/broadcasts/:id", requireAuth, ownerBroadcastReadLimiter, requireOwner, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Broadcast ID tidak valid." });
    const { data, error } = await supabase.rpc("owner_get_broadcast", { p_owner_user_id: req.user.id, p_broadcast_id: req.params.id });
    if (error) throw error;
    return res.json({ ok: true, owner: true, broadcast: data });
  } catch (error) {
    console.error("[OWNER BROADCAST GET ERROR]", error);
    const status = broadcastErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal membaca broadcast." : error.message });
  }
});

app.post("/api/owner/broadcasts", requireAuth, ownerBroadcastMutationLimiter, requireOwner, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const title = typeof body.title === "string" ? body.title : "";
    const message = typeof body.message === "string" ? body.message : "";
    const status = typeof body.status === "string" ? body.status : "draft";
    const recipientFilter = typeof body.recipient_filter === "string" ? body.recipient_filter : "all";
    const scheduledAt = parseBroadcastDate(body.scheduled_at);
    if (body.scheduled_at && !scheduledAt) return res.status(400).json({ ok: false, error: "Waktu jadwal tidak valid." });
    if (title.length > 160 || message.length > 10000) return res.status(400).json({ ok: false, error: "Data broadcast terlalu panjang." });
    const { data, error } = await supabase.rpc("owner_create_broadcast", {
      p_owner_user_id: req.user.id, p_title: title, p_message: message,
      p_status: status, p_scheduled_at: scheduledAt, p_recipient_filter: recipientFilter,
    });
    if (error) throw error;
    return res.status(201).json({ ok: true, owner: true, broadcast: data });
  } catch (error) {
    console.error("[OWNER BROADCAST CREATE ERROR]", error);
    const status = broadcastErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal membuat broadcast." : error.message });
  }
});

app.patch("/api/owner/broadcasts/:id", requireAuth, ownerBroadcastMutationLimiter, requireOwner, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Broadcast ID tidak valid." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const title = typeof body.title === "string" ? body.title : "";
    const message = typeof body.message === "string" ? body.message : "";
    const status = typeof body.status === "string" ? body.status : "draft";
    const recipientFilter = typeof body.recipient_filter === "string" ? body.recipient_filter : "all";
    const scheduledAt = parseBroadcastDate(body.scheduled_at);
    if (body.scheduled_at && !scheduledAt) return res.status(400).json({ ok: false, error: "Waktu jadwal tidak valid." });
    if (title.length > 160 || message.length > 10000) return res.status(400).json({ ok: false, error: "Data broadcast terlalu panjang." });
    const { data, error } = await supabase.rpc("owner_update_broadcast", {
      p_owner_user_id: req.user.id, p_broadcast_id: req.params.id,
      p_title: title, p_message: message, p_status: status,
      p_scheduled_at: scheduledAt, p_recipient_filter: recipientFilter,
    });
    if (error) throw error;
    return res.json({ ok: true, owner: true, broadcast: data });
  } catch (error) {
    console.error("[OWNER BROADCAST UPDATE ERROR]", error);
    const status = broadcastErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal memperbarui broadcast." : error.message });
  }
});

app.delete("/api/owner/broadcasts/:id", requireAuth, ownerBroadcastMutationLimiter, requireOwner, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Broadcast ID tidak valid." });
    const { data, error } = await supabase.rpc("owner_delete_broadcast", { p_owner_user_id: req.user.id, p_broadcast_id: req.params.id });
    if (error) throw error;
    return res.json({ ok: true, owner: true, deleted: data === true });
  } catch (error) {
    console.error("[OWNER BROADCAST DELETE ERROR]", error);
    const status = broadcastErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal menghapus broadcast." : error.message });
  }
});

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

app.get("/api/owner/messages", requireAuth, ownerBroadcastReadLimiter, requireOwner, async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 20, 50);
    const offset = parsePositiveInt(req.query.offset, 0, 1000000);
    if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Parameter pagination tidak valid." });
    const { data, error } = await supabase.rpc("owner_list_conversations", {
      p_owner_user_id: req.user.id, p_limit: limit, p_offset: offset,
    });
    if (error) throw error;
    return res.json({ ok: true, owner: true, ...data });
  } catch (error) {
    console.error("[OWNER MESSAGE LIST ERROR]", error);
    const status = messagingErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal membaca pesan." : error.message });
  }
});

app.get("/api/owner/messages/:conversationId", requireAuth, ownerBroadcastReadLimiter, requireOwner, async (req, res) => {
  try {
    if (!isUuid(req.params.conversationId)) return res.status(400).json({ ok: false, error: "Conversation ID tidak valid." });
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const offset = parsePositiveInt(req.query.offset, 0, 1000000);
    if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Parameter pagination tidak valid." });
    const { data, error } = await supabase.rpc("owner_get_conversation", {
      p_owner_user_id: req.user.id, p_conversation_id: req.params.conversationId,
      p_limit: limit, p_offset: offset,
    });
    if (error) throw error;
    return res.json({ ok: true, owner: true, ...data });
  } catch (error) {
    console.error("[OWNER MESSAGE GET ERROR]", error);
    const status = messagingErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal membaca percakapan." : error.message });
  }
});

app.post("/api/owner/messages", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
  try {
    const memberId = typeof req.body?.member_id === "string" ? req.body.member_id : "";
    if (!isUuid(memberId)) return res.status(400).json({ ok: false, error: "Member ID tidak valid." });
    const { data, error } = await supabase.rpc("owner_create_conversation", {
      p_owner_user_id: req.user.id, p_member_user_id: memberId,
    });
    if (error) throw error;
    return res.status(201).json({ ok: true, owner: true, conversation: data });
  } catch (error) {
    console.error("[OWNER MESSAGE CREATE CONVERSATION ERROR]", error);
    const status = messagingErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal membuat percakapan." : error.message });
  }
});

app.post("/api/owner/messages/:conversationId", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
  try {
    if (!isUuid(req.params.conversationId)) return res.status(400).json({ ok: false, error: "Conversation ID tidak valid." });
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body || body.length > 10000) return res.status(400).json({ ok: false, error: "Isi pesan tidak valid." });
    const { data, error } = await supabase.rpc("owner_send_message", {
      p_owner_user_id: req.user.id, p_conversation_id: req.params.conversationId, p_body: body,
    });
    if (error) throw error;
    return res.status(201).json({ ok: true, owner: true, message: data });
  } catch (error) {
    console.error("[OWNER MESSAGE SEND ERROR]", error);
    const status = messagingErrorStatus(error);
    return res.status(status).json({ ok: false, error: status === 500 ? "Gagal mengirim pesan." : error.message });
  }
});


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

app.get('/api/owner/faq', requireAuth, ownerBroadcastReadLimiter, requireOwner, async (req,res)=>{try{
  const limit=parsePositiveInt(req.query.limit,20,50), offset=parsePositiveInt(req.query.offset,0,1000000);
  if(limit===null||offset===null)return res.status(400).json({ok:false,error:'Pagination tidak valid.'});
  const {data,error}=await supabase.rpc('owner_list_faq',{p_owner_user_id:req.user.id,p_limit:limit,p_offset:offset}); if(error)throw error;
  return res.json({ok:true,owner:true,...data});
}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membaca FAQ.':e.message});}});
app.post('/api/owner/faq', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{
  const b=req.body||{}; if(typeof b.question!=='string'||typeof b.answer!=='string'||b.question.trim().length<3||b.question.length>500||b.answer.trim().length<1||b.answer.length>10000)return res.status(400).json({ok:false,error:'FAQ tidak valid.'});
  const {data,error}=await supabase.rpc('owner_create_faq',{p_owner_user_id:req.user.id,p_question:b.question,p_answer:b.answer,p_category:typeof b.category==='string'?b.category:null,p_sort_order:Number.isInteger(b.sort_order)?b.sort_order:0,p_published:b.published!==false}); if(error)throw error;
  return res.status(201).json({ok:true,owner:true,faq:data});
}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membuat FAQ.':e.message});}});
app.patch('/api/owner/faq/:id', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{
  if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'FAQ ID tidak valid.'}); const b=req.body||{};
  const {data,error}=await supabase.rpc('owner_update_faq',{p_owner_user_id:req.user.id,p_id:req.params.id,p_question:b.question,p_answer:b.answer,p_category:b.category||null,p_sort_order:Number.isInteger(b.sort_order)?b.sort_order:0,p_published:b.published!==false}); if(error)throw error; return res.json({ok:true,owner:true,faq:data});
}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal memperbarui FAQ.':e.message});}});
app.delete('/api/owner/faq/:id', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'FAQ ID tidak valid.'});const {data,error}=await supabase.rpc('owner_delete_faq',{p_owner_user_id:req.user.id,p_id:req.params.id});if(error)throw error;return res.json({ok:true,owner:true,deleted:data===true});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal menghapus FAQ.':e.message});}});

app.get('/api/owner/help', requireAuth, ownerBroadcastReadLimiter, requireOwner, async(req,res)=>{try{const limit=parsePositiveInt(req.query.limit,20,50),offset=parsePositiveInt(req.query.offset,0,1000000);if(limit===null||offset===null)return res.status(400).json({ok:false,error:'Pagination tidak valid.'});const {data,error}=await supabase.rpc('owner_list_help',{p_owner_user_id:req.user.id,p_limit:limit,p_offset:offset});if(error)throw error;return res.json({ok:true,owner:true,...data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membaca Help Center.':e.message});}});
app.post('/api/owner/help', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{const b=req.body||{};if(typeof b.title!=='string'||typeof b.slug!=='string'||typeof b.content!=='string'||b.title.trim().length<3||b.title.length>200||b.content.trim().length<1||b.content.length>20000)return res.status(400).json({ok:false,error:'Artikel Help Center tidak valid.'});const {data,error}=await supabase.rpc('owner_create_help',{p_owner_user_id:req.user.id,p_title:b.title,p_slug:b.slug,p_content:b.content,p_category:typeof b.category==='string'?b.category:null,p_sort_order:Number.isInteger(b.sort_order)?b.sort_order:0,p_published:b.published!==false});if(error)throw error;return res.status(201).json({ok:true,owner:true,help:data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membuat artikel.':e.message});}});
app.patch('/api/owner/help/:id', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'Help ID tidak valid.'});const b=req.body||{};const {data,error}=await supabase.rpc('owner_update_help',{p_owner_user_id:req.user.id,p_id:req.params.id,p_title:b.title,p_slug:b.slug,p_content:b.content,p_category:b.category||null,p_sort_order:Number.isInteger(b.sort_order)?b.sort_order:0,p_published:b.published!==false});if(error)throw error;return res.json({ok:true,owner:true,help:data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal memperbarui artikel.':e.message});}});
app.delete('/api/owner/help/:id', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'Help ID tidak valid.'});const {data,error}=await supabase.rpc('owner_delete_help',{p_owner_user_id:req.user.id,p_id:req.params.id});if(error)throw error;return res.json({ok:true,owner:true,deleted:data===true});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal menghapus artikel.':e.message});}});

app.get('/api/owner/login-activity', requireAuth, ownerBroadcastReadLimiter, requireOwner, async(req,res)=>{try{const limit=parsePositiveInt(req.query.limit,20,50),offset=parsePositiveInt(req.query.offset,0,1000000);if(limit===null||offset===null)return res.status(400).json({ok:false,error:'Pagination tidak valid.'});const {data,error}=await supabase.rpc('owner_list_login_activity',{p_owner_user_id:req.user.id,p_limit:limit,p_offset:offset});if(error)throw error;return res.json({ok:true,owner:true,...data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membaca login activity.':e.message});}});

app.get('/api/owner/maintenance', requireAuth, ownerBroadcastReadLimiter, requireOwner, async(req,res)=>{try{const {data,error}=await supabase.rpc('owner_get_system_settings',{p_owner_user_id:req.user.id});if(error)throw error;return res.json({ok:true,owner:true,settings:data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membaca maintenance.':e.message});}});
app.patch('/api/owner/maintenance', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{const enabled=Boolean(req.body?.enabled),message=typeof req.body?.message==='string'?req.body.message:'';if(message.length>500)return res.status(400).json({ok:false,error:'Pesan maintenance terlalu panjang.'});const {data,error}=await supabase.rpc('owner_set_maintenance',{p_owner_user_id:req.user.id,p_enabled:enabled,p_message:message});if(error)throw error;return res.json({ok:true,owner:true,settings:data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal mengubah maintenance.':e.message});}});
app.get('/api/maintenance', async(_req,res)=>{try{const {data,error}=await supabase.rpc('public_get_maintenance');if(error)throw error;return res.json({ok:true,...data});}catch(e){console.error('[MAINTENANCE ERROR]',e);return res.status(500).json({ok:false,error:'Maintenance status unavailable.'});}});

/* =========================================================
   MEMBER-SIDE NOTIFICATIONS / MESSAGING
========================================================= */
app.get('/api/notifications', requireAuth, ownerBroadcastReadLimiter, async(req,res)=>{try{const limit=parsePositiveInt(req.query.limit,20,50),offset=parsePositiveInt(req.query.offset,0,1000000);if(limit===null||offset===null)return res.status(400).json({ok:false,error:'Pagination tidak valid.'});const {data,error}=await supabase.rpc('member_list_notifications',{p_user_id:req.user.id,p_limit:limit,p_offset:offset});if(error)throw error;return res.json({ok:true,...data});}catch(e){return res.status(/User not found/i.test(String(e.message))?404:500).json({ok:false,error:'Gagal membaca notifikasi.'});}});
app.post('/api/notifications/:id/read', requireAuth, ownerMemberMutationLimiter, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'Notification ID tidak valid.'});const {data,error}=await supabase.rpc('member_mark_notification_read',{p_user_id:req.user.id,p_id:req.params.id});if(error)throw error;return res.json({ok:true,notification:data});}catch(e){return res.status(/not found/i.test(String(e.message))?404:500).json({ok:false,error:'Gagal menandai notifikasi.'});}});
app.get('/api/messages', requireAuth, ownerBroadcastReadLimiter, async(req,res)=>{try{const limit=parsePositiveInt(req.query.limit,20,50),offset=parsePositiveInt(req.query.offset,0,1000000);const {data,error}=await supabase.rpc('member_list_conversations',{p_user_id:req.user.id,p_limit:limit,p_offset:offset});if(error)throw error;return res.json({ok:true,...data});}catch(e){return res.status(500).json({ok:false,error:'Gagal membaca percakapan.'});}});
app.get('/api/messages/:conversationId', requireAuth, ownerBroadcastReadLimiter, async(req,res)=>{try{if(!isUuid(req.params.conversationId))return res.status(400).json({ok:false,error:'Conversation ID tidak valid.'});const {data,error}=await supabase.rpc('member_get_conversation',{p_user_id:req.user.id,p_conversation_id:req.params.conversationId,p_limit:100,p_offset:0});if(error)throw error;return res.json({ok:true,...data});}catch(e){return res.status(/Conversation not found/i.test(String(e.message))?404:500).json({ok:false,error:'Gagal membaca percakapan.'});}});
app.post('/api/messages/:conversationId', requireAuth, ownerMemberMutationLimiter, async(req,res)=>{try{if(!isUuid(req.params.conversationId))return res.status(400).json({ok:false,error:'Conversation ID tidak valid.'});const body=typeof req.body?.body==='string'?req.body.body.trim():'';if(!body||body.length>10000)return res.status(400).json({ok:false,error:'Isi pesan tidak valid.'});const {data,error}=await supabase.rpc('member_send_message',{p_user_id:req.user.id,p_conversation_id:req.params.conversationId,p_body:body});if(error)throw error;return res.status(201).json({ok:true,message:data});}catch(e){return res.status(/Conversation not found/i.test(String(e.message))?404:500).json({ok:false,error:'Gagal mengirim pesan.'});}});
app.post('/api/messages/:conversationId/read', requireAuth, ownerMemberMutationLimiter, async(req,res)=>{try{if(!isUuid(req.params.conversationId))return res.status(400).json({ok:false,error:'Conversation ID tidak valid.'});const {data,error}=await supabase.rpc('member_mark_messages_read',{p_user_id:req.user.id,p_conversation_id:req.params.conversationId});if(error)throw error;return res.json({ok:true,updated:data});}catch(e){return res.status(500).json({ok:false,error:'Gagal menandai pesan.'});}});

app.post('/api/owner/broadcasts/:id/execute', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'Broadcast ID tidak valid.'});const {data,error}=await supabase.rpc('owner_execute_broadcast',{p_owner_user_id:req.user.id,p_broadcast_id:req.params.id});if(error)throw error;return res.json({ok:true,owner:true,...data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal menjalankan broadcast.':e.message});}});

/* =========================================================
   OWNER STATISTICS / HEALTH
========================================================= */

async function fetchOwnerGenerationStatistics(userId) {
  const { data, error } = await supabase.rpc(
    "owner_generation_statistics",
    { p_user_id: userId }
  );

  if (error) throw error;
  return data || { today: 0, week: 0, month: 0, sevenDays: [] };
}

app.get(
  "/api/owner/statistics",
  requireAuth,
  ownerStatisticsLimiter,
  requireOwner,
  async (req, res) => {
    try {
      const statistics = await fetchOwnerGenerationStatistics(req.user.id);

      return res.json({
        ok: true,
        owner: true,
        statistics,
      });
    } catch (error) {
      console.error("[OWNER STATISTICS ERROR]", error);
      return res.status(500).json({
        ok: false,
        owner: true,
        error: "Gagal membaca statistik Owner.",
      });
    }
  }
);

app.get(
  "/api/owner/health",
  requireAuth,
  ownerReadLimiter,
  requireOwner,
  async (_req, res) => {
    try {
      const { error } = await supabase
        .from("am_api_usage")
        .select("usage_date")
        .limit(1);

      if (error) {
        return res.status(503).json({
          ok: false,
          owner: true,
          database: "error",
        });
      }

      return res.json({
        ok: true,
        owner: true,
        database: "connected",
      });
    } catch (error) {
      console.error("[OWNER HEALTH ERROR]", error);
      return res.status(503).json({
        ok: false,
        owner: true,
        database: "error",
      });
    }
  }
);

/* =========================================================
   RATE LIMIT
========================================================= */

const generateLimiter =
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,

    // /api/generate is mounted after requireAuth, so the account UUID
    // is available here. The limiter is therefore isolated per account,
    // not per IP address.
    keyGenerator: (req) => {
      const userId = req.user?.id;
      return userId ? `user:${userId}` : "unauthenticated";
    },

    message: {
      ok: false,
      error:
        "Batas request akun tercapai. Coba lagi nanti.",
    },
  });

/* =========================================================
   UTILITY
========================================================= */

function todayUTC() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}

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

app.post("/api/internal/provider/magiclink-delivery", (req, res) => {
  if (!PROVIDER_DELIVERY_WEBHOOK_ENABLED) return res.status(404).json({ ok: false, error: "Delivery webhook tidak diaktifkan." });
  const provided = req.get("x-provider-diagnostic-secret") || "";
  if (!timingSafeSecretEquals(provided, PROVIDER_DIAGNOSTIC_SECRET)) return res.status(401).json({ ok: false, error: "Diagnostic authentication failed." });
  const email = normalizeUserEmail(req.body?.email);
  const state = normalizeDeliveryState(req.body?.status || req.body?.event || req.body?.deliveryStatus);
  const codeOrder = String(req.body?.codeOrder || req.body?.codeorder || "").trim().slice(0, 160) || null;
  if (!email.valid || !state) return res.status(400).json({ ok: false, error: "email dan delivery status valid diperlukan." });

  return (async () => {
    const deliveryUpdate = {
      magic_link_delivery_status: state,
      magic_link_delivery_confirmed_at: state === "delivery_confirmed" ? new Date().toISOString() : null,
      magic_link_last_error: state === "delivery_failed" ? "Provider melaporkan delivery gagal." : null,
      magic_link_code_order: codeOrder,
    };

    // Prefer the provider correlation key when available. Never fall back to a
    // different pending account for a webhook that already carries codeOrder.
    let data = null;
    let error = null;
    if (codeOrder) {
      ({ data, error } = await supabase
        .from("am_generated_accounts")
        .update(deliveryUpdate)
        .eq("email", email.value)
        .eq("magic_link_code_order", codeOrder)
        .eq("email_verification_status", "pending")
        .select("id")
        .limit(1));
    } else {
      ({ data, error } = await supabase
        .from("am_generated_accounts")
        .update(deliveryUpdate)
        .eq("email", email.value)
        .eq("email_verification_status", "pending")
        .select("id")
        .order("magic_link_requested_at", { ascending: false })
        .limit(1));
    }
    if (error) throw error;
    const accountId = Array.isArray(data) && data[0]?.id ? data[0].id : null;
    if (accountId) {
      await supabase.from("am_generation_logs").insert({
        account_id: accountId,
        event: state === "delivery_confirmed" ? "v1_magiclink_delivery_confirmed" : "v1_magiclink_delivery_failed",
        status_code: 200,
        message: state === "delivery_confirmed" ? "Provider confirmed magic-link delivery." : "Provider reported magic-link delivery failure.",
        metadata: { flow: "user_email_manual_activation", code_order: codeOrder, delivery_status: state },
      });
    }
    return res.status(202).json({ ok: true, accepted: true, deliveryStatus: state, accountId });
  })().catch((error) => {
    console.error("[PROVIDER DELIVERY WEBHOOK ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
    return res.status(500).json({ ok: false, error: "Delivery event tidak dapat diproses." });
  });
});

/* =========================================================
   ERROR RESPONSE
========================================================= */

function publicError(
  error
) {
  console.error(
    "[SERVER ERROR]",
    error
  );

  return {
    ok: false,
    error:
      "Terjadi kesalahan pada server.",
  };
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  async (_req, res) => {
    try {
      const {
        error,
      } = await supabase
        .from(
          "am_api_usage"
        )
        .select(
          "usage_date"
        )
        .limit(1);

      if (error) {
        return res
          .status(503)
          .json({
            ok: false,
            database:
              "error",
          });
      }

      return res.json({
        ok: true,
        database:
          "connected",
      });
    } catch (error) {
      console.error(
        "[HEALTH ERROR]",
        error
      );

      return res
        .status(503)
        .json({
          ok: false,
          database:
            "error",
        });
    }
  }
);

/* =========================================================
   ACCOUNT HISTORY
========================================================= */

const confirmMagicLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  handler: (_req, res) =>
    res.status(429).json({
      ok: false,
      error: "Batas percobaan magic link tercapai. Coba lagi nanti.",
    }),
});

app.post(
  "/api/accounts/:id/verify-email",
  requireAuth,
  confirmMagicLinkLimiter,
  async (req, res) => {
    const accountId = String(req.params.id || "").trim();
    if (!isUuid(accountId)) return res.status(400).json({ ok: false, error: "Account ID tidak valid." });

    const rawLinkInput = typeof req.body?.rawLink === "string" ? req.body.rawLink.trim() : "";
    const normalizedLink = normalizeMagicLink(rawLinkInput);
    if (!normalizedLink.valid) {
      return res.status(400).json({
        ok: false,
        verified: false,
        premiumApplied: false,
        code: "RAW_MAGIC_LINK_INVALID",
        error: "Magic link tidak valid atau host/path tidak diizinkan.",
      });
    }

    try {
      const { data: account, error: accountError } = await supabase
        .from("am_generated_accounts")
        .select("id,email,status,provider_response,email_verified_at,email_verification_status,provider_id_token_encrypted,provider_token_expires_at")
        .eq("id", accountId)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (accountError) throw accountError;
      if (!account) return res.status(404).json({ ok: false, error: "Account tidak ditemukan." });

      if (account.email_verification_status === "verified" && account.email_verified_at) {
        return res.json({
          ok: true,
          verified: true,
          premiumApplied: account.status === "success",
          source: "database",
          message: account.status === "success"
            ? "Email sudah diverifikasi dan Premium sudah aktif."
            : "Email sudah diverifikasi. Lanjutkan ke Generate / Activate untuk mengaktifkan Premium.",
        });
      }

      const email = normalizeUserEmail(account.email);
      if (!email.valid) return res.status(409).json({ ok: false, error: "Email account tidak tersedia atau tidak valid." });

      const providerKey = env("PROVIDER_API_KEY");
      const providerBase = envHttpUrl("PROVIDER_BASE_URL");
      const today = todayUTC();
      const verifyQuota = await reserveProviderRequest(today, PROVIDER_VERIFY_ACCOUNT_PATH);
      if (!verifyQuota?.allowed) {
        return res.status(429).json({ ok: false, error: "Batas harian request provider tercapai." });
      }

      const result = await callProviderVerifyAccount({
        providerBase,
        providerKey,
        email: email.value,
        rawLink: normalizedLink.value,
      });
      await recordProviderRequestResult(today, PROVIDER_VERIFY_ACCOUNT_PATH, result.attempted && result.status !== null ? result.ok : false);

      if (!result.ok) {
        return res.status(result.status && result.status >= 400 ? result.status : 502).json({
          ok: false,
          verified: false,
          premiumApplied: false,
          code: result.reason,
          providerError: result.providerError || null,
          message: "Provider gagal memverifikasi magic link.",
        });
      }

      const claims = decodeJwtPayloadSafe(result.idToken);
      const tokenEmail = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!claims || !tokenEmail || tokenEmail !== email.value) {
        return res.status(502).json({ ok: false, verified: false, premiumApplied: false, code: "ID_TOKEN_EMAIL_MISMATCH", error: "Identitas token provider tidak cocok dengan email account." });
      }
      if (claims.email_verified !== true) {
        return res.status(502).json({ ok: false, verified: false, premiumApplied: false, code: "ID_TOKEN_EMAIL_NOT_VERIFIED", error: "Provider tidak memberikan token terverifikasi." });
      }
      if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= nowSeconds) {
        return res.status(502).json({ ok: false, verified: false, premiumApplied: false, code: "ID_TOKEN_EXPIRED", error: "ID token provider sudah kedaluwarsa." });
      }

      const encryptedToken = encryptProviderIdToken(result.idToken);
      const tokenExpiresAt = new Date(Number(claims.exp) * 1000).toISOString();
      const verifiedAt = new Date().toISOString();
      const safeVerification = sanitizeProviderResponse(result.data);

      const { error: updateError } = await supabase
        .from("am_generated_accounts")
        .update({
          email_verified_at: verifiedAt,
          email_verification_status: "verified",
          provider_token_expires_at: tokenExpiresAt,
          provider_id_token_encrypted: encryptedToken,
          provider_status_code: result.status,
          provider_message: result.data?.message || result.data?.data?.message || "Email verification completed successfully.",
          provider_response: safeVerification,
        })
        .eq("id", accountId)
        .eq("user_id", req.user.id);

      if (updateError) throw updateError;

      await supabase.from("am_generation_logs").insert({
        account_id: accountId,
        event: "v1_magiclink_verified",
        status_code: result.status,
        message: "Magic link verified; Premium activation is waiting for user confirmation.",
        metadata: { flow: "user_email_manual_activation", verify_status: result.status, token_expires_at: tokenExpiresAt },
      });

      return res.json({
        ok: true,
        verified: true,
        premiumApplied: false,
        verifiedAt,
        nextStep: "apply_premium",
        message: "Magic link terverifikasi. Klik Generate / Activate untuk mengaktifkan Premium.",
      });
    } catch (error) {
      console.error("[VERIFY V1 ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
      return res.status(Number.isInteger(error?.status) ? error.status : 500).json({
        ok: false,
        verified: false,
        premiumApplied: false,
        error: error?.status ? error.message : "Gagal menyelesaikan verifikasi magic link.",
      });
    }
  }
);

app.post(
  "/api/accounts/:id/apply-premium",
  requireAuth,
  confirmMagicLinkLimiter,
  async (req, res) => {
    const accountId = String(req.params.id || "").trim();
    if (!isUuid(accountId)) return res.status(400).json({ ok: false, error: "Account ID tidak valid." });

    try {
      const { data: account, error: accountError } = await supabase
        .from("am_generated_accounts")
        .select("id,email,status,provider_response,email_verified_at,email_verification_status,provider_id_token_encrypted,provider_token_expires_at")
        .eq("id", accountId)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (accountError) throw accountError;
      if (!account) return res.status(404).json({ ok: false, error: "Account tidak ditemukan." });

      if (account.status === "success" && account.email_verification_status === "verified") {
        const premium = account.provider_response?.premium || account.provider_response?.data?.result || {};
        return res.json({
          ok: true,
          verified: true,
          premiumApplied: true,
          source: "database",
          premium: {
            valid: premium.valid === true,
            status: premium.status || "success",
            expiryTimeMillis: Number(premium.expiryTimeMillis) || null,
          },
          message: "Amprem sudah berhasil diaktifkan sebelumnya.",
        });
      }

      if (account.email_verification_status !== "verified" || !account.email_verified_at) {
        return res.status(409).json({ ok: false, verified: false, premiumApplied: false, code: "VERIFICATION_REQUIRED", error: "Verifikasi magic link terlebih dahulu." });
      }
      if (!account.provider_id_token_encrypted) {
        return res.status(409).json({ ok: false, verified: true, premiumApplied: false, code: "PROVIDER_TOKEN_MISSING", error: "Sesi verifikasi sudah tidak tersedia. Ulangi verifikasi dengan magic link terbaru." });
      }

      const tokenExpiry = new Date(account.provider_token_expires_at || 0).getTime();
      if (!Number.isFinite(tokenExpiry) || tokenExpiry <= Date.now()) {
        await supabase.from("am_generated_accounts").update({ provider_id_token_encrypted: null, provider_token_expires_at: null }).eq("id", accountId).eq("user_id", req.user.id);
        return res.status(409).json({ ok: false, verified: true, premiumApplied: false, code: "PROVIDER_TOKEN_EXPIRED", error: "Sesi verifikasi sudah kedaluwarsa. Minta dan tempel magic link terbaru." });
      }

      const email = normalizeUserEmail(account.email);
      if (!email.valid) return res.status(409).json({ ok: false, error: "Email account tidak valid." });
      const idToken = decryptProviderIdToken(account.provider_id_token_encrypted);
      const claims = decodeJwtPayloadSafe(idToken);
      const tokenEmail = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!claims || tokenEmail !== email.value || claims.email_verified !== true || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= nowSeconds) {
        await supabase.from("am_generated_accounts").update({ provider_id_token_encrypted: null, provider_token_expires_at: null }).eq("id", accountId).eq("user_id", req.user.id);
        return res.status(409).json({ ok: false, verified: false, premiumApplied: false, code: "PROVIDER_TOKEN_INVALID", error: "Sesi provider tidak valid atau sudah kedaluwarsa. Ulangi verifikasi magic link terbaru." });
      }

      // Atomically claim this account before calling the provider. This is the
      // server-side concurrency guard; frontend button disabling is only UX.
      const activationClaimToken = crypto.randomBytes(32).toString("hex");
      const { data: claimRows, error: claimError } = await supabase.rpc("claim_premium_activation", {
        p_user_id: req.user.id,
        p_account_id: accountId,
        p_claim_token: activationClaimToken,
        p_stale_after_seconds: 120,
      });
      if (claimError) throw claimError;
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      if (!claim?.claimed) {
        if (claim?.reason === "already_claimed") {
          return res.status(409).json({ ok: false, verified: true, premiumApplied: false, code: "ACTIVATION_IN_PROGRESS", error: "Aktivasi Premium sedang diproses. Tunggu sebentar lalu coba lagi." });
        }
        return res.status(409).json({ ok: false, verified: true, premiumApplied: false, code: "ACTIVATION_STATE_CHANGED", error: "Status account berubah. Muat ulang account lalu coba lagi." });
      }

      const releaseActivationClaim = async () => {
        try {
          await supabase.rpc("release_premium_activation_claim", {
            p_user_id: req.user.id,
            p_account_id: accountId,
            p_claim_token: activationClaimToken,
          });
        } catch (releaseError) {
          console.error("[PREMIUM ACTIVATION CLAIM RELEASE ERROR]", releaseError);
        }
      };

      const providerKey = env("PROVIDER_API_KEY");
      const providerBase = env("PROVIDER_BASE_URL");
      const today = todayUTC();
      const premiumQuota = await reserveProviderRequest(today, PROVIDER_APPLY_PREMIUM_PATH);
      if (!premiumQuota?.allowed) {
        await releaseActivationClaim();
        return res.status(429).json({ ok: false, verified: true, premiumApplied: false, error: "Batas harian request provider tercapai sebelum apply-premium." });
      }

      const premium = await callProviderApplyPremium({ providerBase, providerKey, email: email.value, idToken });
      await recordProviderRequestResult(today, PROVIDER_APPLY_PREMIUM_PATH, premium.attempted && premium.status !== null ? premium.ok : false);

      if (!premium.ok) {
        await releaseActivationClaim();
        return res.status(premium.status && premium.status >= 400 ? premium.status : 502).json({
          ok: false,
          verified: true,
          premiumApplied: false,
          code: premium.reason,
          providerError: premium.providerError || null,
          message: "Verifikasi berhasil, tetapi apply-premium gagal. Coba Generate / Activate lagi.",
        });
      }

      const providerPremiumEmail = premium.returnedEmail ? premium.returnedEmail.trim().toLowerCase() : "";
      if (providerPremiumEmail && providerPremiumEmail !== email.value) {
        await releaseActivationClaim();
        return res.status(502).json({ ok: false, verified: true, premiumApplied: false, code: "PREMIUM_EMAIL_MISMATCH", error: "Provider apply-premium mengembalikan email berbeda." });
      }

      const verifiedAt = account.email_verified_at || new Date().toISOString();
      const safePremium = sanitizeProviderResponse(premium.data);
      const { data: finalizedRows, error: updateError } = await supabase
        .from("am_generated_accounts")
        .update({
          status: "success",
          email_verified_at: verifiedAt,
          email_verification_status: "verified",
          provider_status_code: premium.status,
          provider_message: premium.data?.data?.message || premium.data?.message || "Premium activation applied successfully.",
          provider_response: safePremium,
          provider_id_token_encrypted: null,
          provider_token_expires_at: null,
          premium_activation_claim_token: null,
          premium_activation_claimed_at: null,
        })
        .eq("id", accountId)
        .eq("user_id", req.user.id)
        .eq("premium_activation_claim_token", activationClaimToken)
        .select("id");

      if (updateError) throw updateError;
      if (!Array.isArray(finalizedRows) || finalizedRows.length !== 1) {
        console.error("[PREMIUM ACTIVATION CLAIM LOST AFTER PROVIDER SUCCESS]", { accountId });
        return res.status(500).json({ ok: false, verified: true, premiumApplied: false, code: "ACTIVATION_FINALIZE_CONFLICT", error: "Provider berhasil merespons, tetapi penyelesaian account gagal. Hubungi Owner sebelum mengulangi aktivasi." });
      }

      // Member quota is consumed only after STEP 3 (apply-premium) succeeds.
      // The send-magiclink acceptance itself never consumes member quota.
      const userQuota = await consumeMagicLinkQuota(
        req.user.id,
        accountId,
        todayUTC(),
        MAGIC_LINK_DAILY_LIMIT,
        "premium_activation"
      );

      if (!userQuota?.allowed && userQuota?.reason !== "ALREADY_CONSUMED") {
        console.error("[MAGIC LINK QUOTA POST-PREMIUM RECORDING WARNING]", {
          accountId,
          reason: userQuota?.reason || "UNKNOWN",
          consumed: userQuota?.consumed_count ?? null,
          limit: MAGIC_LINK_DAILY_LIMIT,
        });
      }

      await supabase.from("am_generation_logs").insert({
        account_id: accountId,
        event: "v1_manual_premium_success",
        status_code: premium.status,
        message: premium.data?.data?.message || premium.data?.message || "Premium activation applied successfully.",
        metadata: { flow: "user_email_manual_activation", verify_status: account.email_verified_at, apply_premium_status: premium.status, premium_valid: true },
      });

      return res.json({
        ok: true,
        verified: true,
        premiumApplied: true,
        verifiedAt,
        premium: {
          valid: true,
          status: premium.providerResult?.status || "success",
          expiryTimeMillis: Number(premium.providerResult?.expiryTimeMillis) || null,
          autoRenewing: premium.providerResult?.autoRenewing === true,
          testPurchase: premium.providerResult?.testPurchase === true,
        },
        message: "Email terverifikasi dan Premium berhasil diterapkan.",
      });
    } catch (error) {
      console.error("[APPLY PREMIUM V1 ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
      return res.status(Number.isInteger(error?.status) ? error.status : 500).json({
        ok: false,
        verified: true,
        premiumApplied: false,
        error: error?.status ? error.message : "Gagal mengaktifkan Premium.",
      });
    }
  }
);

app.get(
  "/api/accounts",
  requireAuth,
  async (req, res) => {
    try {
      const {
        data,
        error,
      } = await supabase
        .from(
          "am_generated_accounts"
        )
        .select(
          [
            "id",
            "email",
            "status",
            "provider_status_code",
            "provider_message",
            "email_verified_at",
            "email_verification_status",
            "magic_link_requested_at",
            "magic_link_delivery_status",
            "magic_link_code_order",
            "magic_link_delivery_confirmed_at",
            "created_at",
          ].join(",")
        )
        .eq(
          "user_id",
          req.user.id
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          }
        )
        .limit(100);

      if (error) {
        console.error(
          "[ACCOUNTS ERROR]",
          error
        );

        return res
          .status(500)
          .json({
            ok: false,
            error:
              "Gagal membaca riwayat.",
          });
      }

      const accounts =
        (data || []).map(
          (account) => ({
            id:
              account.id,

            email:
              account.email,

            status:
              account.status,

            provider_status_code:
              account.provider_status_code,

            provider_message:
              account.provider_message,

            magic_link_requested_at: account.magic_link_requested_at,
            magic_link_delivery_status: account.magic_link_delivery_status || "not_requested",
            magic_link_code_order: account.magic_link_code_order || null,
            magic_link_delivery_confirmed_at: account.magic_link_delivery_confirmed_at || null,

            created_at:
              account.created_at,
          })
        );

      return res.json({
        ok: true,
        accounts,
      });
    } catch (error) {
      return res
        .status(500)
        .json(
          publicError(
            error
          )
        );
    }
  }
);

/* =========================================================
   DAILY USAGE — PER USER
========================================================= */

app.get(
  "/api/usage",
  requireAuth,
  async (req, res) => {
    try {
      const today =
        todayUTC();

      const {
        data,
        error,
      } = await supabase
        .from("am_magic_link_quota_usage")
        .select("usage_date,consumed_count")
        .eq("usage_date", today)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (error) {
        console.error(
          "[USAGE ERROR]",
          error
        );

        return res
          .status(500)
          .json({
            ok: false,
            error:
              "Gagal membaca usage.",
          });
      }

      const usage =
        data || {
          usage_date:
            today,

          consumed_count:
            0,
        };

      return res.json({
        ok: true,

        usage: {
          usage_date:
            usage.usage_date,

          request_count:
            safeNumber(usage.consumed_count),
          consumed_count:
            safeNumber(usage.consumed_count),
        },

        limit:
          MAGIC_LINK_DAILY_LIMIT,
      });
    } catch (error) {
      return res
        .status(500)
        .json(
          publicError(
            error
          )
        );
    }
  }
);

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
  const { data, error } = await supabase.rpc("claim_generation_request", {
    p_user_id: userId,
    p_idempotency_hash: hashIdempotencyKey(idempotencyKey),
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function finalizeGenerationRequest(userId, idempotencyKey, state, httpStatus, responseBody) {
  const { error } = await supabase.rpc("finalize_generation_request", {
    p_user_id: userId,
    p_idempotency_hash: hashIdempotencyKey(idempotencyKey),
    p_state: state,
    p_http_status: httpStatus,
    p_response_body: responseBody || {},
  });
  if (error) console.error("[IDEMPOTENCY FINALIZE ERROR]", error);
}

async function reserveProviderRequest(usageDate, endpoint) {
  const { data, error } = await supabase.rpc("reserve_provider_api_request", {
    p_usage_date: usageDate,
    p_endpoint: endpoint,
    p_daily_limit: PROVIDER_DAILY_REQUEST_LIMIT,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function recordProviderRequestResult(usageDate, endpoint, success) {
  const { error } = await supabase.rpc("record_provider_api_result", {
    p_usage_date: usageDate,
    p_endpoint: endpoint,
    p_success: Boolean(success),
  });
  if (error) console.error("[PROVIDER QUOTA RESULT ERROR]", error);
}

async function consumeMagicLinkQuota(userId, accountId, usageDate, dailyLimit, source) {
  const { data, error } = await supabase.rpc("consume_magic_link_quota", {
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

app.get("/api/accounts/:id/magiclink-status", requireAuth, async (req, res) => {
  const accountId = String(req.params.id || "").trim();
  if (!isUuid(accountId)) return res.status(400).json({ ok: false, error: "Account ID tidak valid." });
  try {
    const { data, error } = await supabase
      .from("am_generated_accounts")
      .select("id,email,email_verification_status,magic_link_requested_at,magic_link_delivery_status,magic_link_code_order,magic_link_delivery_confirmed_at,magic_link_last_error")
      .eq("id", accountId)
      .eq("user_id", req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, error: "Account tidak ditemukan." });
    return res.json({
      ok: true,
      accountId: data.id,
      email: data.email,
      verificationStatus: data.email_verification_status,
      requestedAt: data.magic_link_requested_at,
      deliveryStatus: data.magic_link_delivery_status || "not_requested",
      deliveryConfirmed: data.magic_link_delivery_status === "delivery_confirmed",
      deliveryConfirmedAt: data.magic_link_delivery_confirmed_at,
      codeOrder: data.magic_link_code_order,
      lastError: data.magic_link_last_error,
    });
  } catch (error) {
    console.error("[MAGIC LINK STATUS ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
    return res.status(500).json({ ok: false, error: "Gagal membaca status magic link." });
  }
});

/* =========================================================
   RESEND MAGIC LINK
========================================================= */

const resendMagicLinkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  message: { ok: false, error: "Batas kirim ulang magic link tercapai. Tunggu beberapa menit." },
});

app.post("/api/accounts/:id/send-magiclink", requireAuth, resendMagicLinkLimiter, async (req, res) => {
  const accountId = String(req.params.id || "").trim();
  if (!isUuid(accountId)) return res.status(400).json({ ok: false, error: "Account ID tidak valid." });
  try {
    const { data: account, error: accountError } = await supabase
      .from("am_generated_accounts")
      .select("id,email,status,email_verification_status")
      .eq("id", accountId)
      .eq("user_id", req.user.id)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return res.status(404).json({ ok: false, error: "Account tidak ditemukan." });
    if (account.email_verification_status === "verified") return res.status(409).json({ ok: false, error: "Email account sudah diverifikasi." });

    const emailInput = normalizeUserEmail(account.email);
    if (!emailInput.valid) return res.status(409).json({ ok: false, error: "Email account tidak valid." });
    const providerKey = env("PROVIDER_API_KEY");
    const providerBase = envHttpUrl("PROVIDER_BASE_URL");
    const today = todayUTC();
    const quota = await reserveProviderRequest(today, PROVIDER_SEND_MAGICLINK_PATH);
    if (!quota?.allowed) return res.status(429).json({ ok: false, error: "Batas harian request provider tercapai." });

    const send = await callProviderSendMagicLink({ providerBase, providerKey, email: emailInput.value });
    await recordProviderRequestResult(today, PROVIDER_SEND_MAGICLINK_PATH, send.attempted && send.status !== null ? send.ok : false);
    if (!send.ok) {
      await supabase.from("am_generated_accounts").update({
        magic_link_delivery_status: "delivery_failed",
        magic_link_last_error: "Provider gagal menerima request magic link baru.",
        provider_status_code: send.status,
        provider_response: sanitizeProviderResponse(send.data),
      }).eq("id", accountId).eq("user_id", req.user.id);
      return res.status(send.status && send.status >= 400 ? send.status : 502).json({ ok: false, code: send.reason, error: "Provider gagal menerima permintaan magic link baru." });
    }

    const requestedAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("am_generated_accounts").update({
      status: "pending",
      email: emailInput.value,
      email_verification_status: "pending",
      email_verified_at: null,
      magic_link_requested_at: requestedAt,
      magic_link_delivery_status: "provider_accepted",
      magic_link_code_order: send.codeOrder,
      magic_link_delivery_confirmed_at: null,
      magic_link_last_error: null,
      provider_status_code: send.status,
      provider_message: send.data?.message || send.data?.data?.message || "Provider accepted the resend request.",
      provider_response: sanitizeProviderResponse(send.data),
      provider_id_token_encrypted: null,
      provider_token_expires_at: null,
    }).eq("id", accountId).eq("user_id", req.user.id);
    if (updateError) throw updateError;

    await supabase.from("am_generation_logs").insert({
      account_id: accountId,
      event: "v1_magiclink_resent",
      status_code: send.status,
      message: "Provider accepted a fresh magic-link request; delivery is not yet confirmed.",
      metadata: { flow: "user_email_manual_activation", code_order: send.codeOrder, delivery_status: "provider_accepted" },
    });

    return res.json({
      ok: true, accountId, email: emailInput.value, deliveryAccepted: true, deliveryConfirmed: false,
      deliveryStatus: "provider_accepted", codeOrder: send.codeOrder, magicLinkAvailableInProviderResponse: false,
      message: "Provider menerima permintaan baru. Cek inbox/spam dan gunakan magic link terbaru."
    });
  } catch (error) {
    console.error("[RESEND MAGIC LINK ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
    return res.status(Number.isInteger(error?.status) ? error.status : 500).json({ ok: false, error: "Gagal mengirim ulang magic link." });
  }
});

/* =========================================================
   GENERATE
========================================================= */

app.post(
  "/api/generate",
  requireAuth,
  generateLimiter,
  async (req, res) => {
    let accountId = null;
    const idempotencyKey = normalizeIdempotencyKey(req.get("Idempotency-Key"));
    const idempotencyEnabled = Boolean(idempotencyKey);
    let idempotencyFinalized = false;
    const today = todayUTC();

    try {
      if (req.get("Idempotency-Key") && !idempotencyKey) {
        return res.status(400).json({ ok: false, error: "Idempotency-Key harus 1–128 karakter." });
      }

      const emailInput = normalizeUserEmail(req.body?.email);
      if (!emailInput.valid) {
        const messages = {
          MISSING: "Email wajib diisi.",
          TOO_LONG: "Email terlalu panjang.",
          WHITESPACE: "Email tidak boleh mengandung spasi.",
          FORMAT: "Format email tidak valid.",
        };
        return res.status(400).json({ ok: false, code: `EMAIL_${emailInput.reason}`, error: messages[emailInput.reason] || "Email tidak valid." });
      }

      const providerKey = env("PROVIDER_API_KEY");
      const providerBase = env("PROVIDER_BASE_URL");

      if (idempotencyKey) {
        const claim = await claimGenerationRequest(req.user.id, idempotencyKey);
        if (!claim?.is_new) {
          if (claim.state === "completed" || claim.state === "failed") {
            return res.status(Number(claim.http_status || (claim.state === "completed" ? 200 : 502))).json({ ...(claim.response_body || {}), idempotentReplay: true });
          }
          return res.status(409).json({ ok: false, error: "Request dengan Idempotency-Key yang sama masih diproses.", accountId: claim.account_id || null, idempotentReplay: true });
        }
        accountId = claim.account_id;
      }

      if (!accountId) {
        const { data: account, error: insertError } = await supabase
          .from("am_generated_accounts")
          .insert({
            user_id: req.user.id,
            status: "pending",
            email: emailInput.value,
            email_verification_status: "pending",
            email_verified_at: null,
            provider_id_token_encrypted: null,
            provider_token_expires_at: null,
            provider_response: {},
          })
          .select("id")
          .single();

        if (insertError) throw insertError;
        accountId = account.id;
      } else {
        const { error: existingUpdateError } = await supabase
          .from("am_generated_accounts")
          .update({
            email: emailInput.value,
            status: "pending",
            email_verification_status: "pending",
            email_verified_at: null,
            provider_id_token_encrypted: null,
            provider_token_expires_at: null,
            provider_response: {},
          })
          .eq("id", accountId)
          .eq("user_id", req.user.id);
        if (existingUpdateError) throw existingUpdateError;
      }

      const quota = await reserveProviderRequest(today, PROVIDER_SEND_MAGICLINK_PATH);
      if (!quota?.allowed) {
        const body = { ok: false, error: "Batas harian request provider tercapai.", accountId, email: emailInput.value, step: "request_magiclink" };
        await supabase.from("am_generated_accounts").update({ status: "failed", provider_message: body.error }).eq("id", accountId).eq("user_id", req.user.id);
        if (idempotencyEnabled) {
          await finalizeGenerationRequest(req.user.id, idempotencyKey, "failed", 429, body);
          idempotencyFinalized = true;
        }
        return res.status(429).json(body);
      }

      const send = await callProviderSendMagicLink({ providerBase, providerKey, email: emailInput.value });
      await recordProviderRequestResult(today, PROVIDER_SEND_MAGICLINK_PATH, send.attempted && send.status !== null ? send.ok : false);

      if (!send.ok) {
        await supabase.from("am_generated_accounts").update({
          status: "failed",
          provider_status_code: send.status,
          provider_message: "Provider gagal mengirim magic link.",
          provider_response: sanitizeProviderResponse(send.data),
        }).eq("id", accountId).eq("user_id", req.user.id);

        const body = { ok: false, error: "Provider gagal mengirim magic link.", accountId, email: emailInput.value, code: send.reason };
        if (idempotencyEnabled) {
          await finalizeGenerationRequest(req.user.id, idempotencyKey, "failed", send.status && send.status >= 400 ? send.status : 502, body);
          idempotencyFinalized = true;
        }
        return res.status(send.status && send.status >= 400 ? send.status : 502).json(body);
      }

      const providerEmail = extractProviderEmail(send.data).value?.trim().toLowerCase() || "";
      if (providerEmail && providerEmail !== emailInput.value) {
        await supabase.from("am_generated_accounts").update({
          status: "failed",
          provider_status_code: send.status,
          provider_message: "Provider mengembalikan email berbeda dari email yang diminta.",
          provider_response: sanitizeProviderResponse(send.data),
        }).eq("id", accountId).eq("user_id", req.user.id);

        const body = { ok: false, error: "Provider mengembalikan email yang berbeda dari email yang diminta.", accountId, code: "PROVIDER_EMAIL_MISMATCH" };
        if (idempotencyEnabled) {
          await finalizeGenerationRequest(req.user.id, idempotencyKey, "failed", 502, body);
          idempotencyFinalized = true;
        }
        return res.status(502).json(body);
      }

      const requestedAt = new Date().toISOString();
      const safe = sanitizeProviderResponse(send.data);
      const { error: updateError } = await supabase.from("am_generated_accounts").update({
        status: "pending",
        email: emailInput.value,
        email_verification_status: "pending",
        email_verified_at: null,
        provider_status_code: send.status,
        provider_message: send.data?.message || send.data?.data?.message || "Provider accepted the magic-link request; delivery is not yet confirmed.",
        provider_response: safe,
        magic_link_requested_at: requestedAt,
        magic_link_delivery_status: send.deliveryStatus || "provider_accepted",
        magic_link_code_order: send.codeOrder,
        magic_link_delivery_confirmed_at: null,
        magic_link_last_error: null,
        provider_id_token_encrypted: null,
        provider_token_expires_at: null,
      }).eq("id", accountId).eq("user_id", req.user.id);
      if (updateError) throw updateError;

      await supabase.from("am_generation_logs").insert({
        account_id: accountId,
        event: "v1_magiclink_requested",
        status_code: send.status,
        message: send.data?.message || send.data?.data?.message || "Provider accepted the magic-link request; waiting for mailbox delivery or user-provided link.",
        metadata: { flow: "user_email_manual_activation", email_domain: emailInput.value.split("@").pop(), code_order: send.codeOrder, delivery_status: send.deliveryStatus || "provider_accepted", magic_link_in_response: Boolean(send.magicLink) },
      });

      const body = {
        ok: true,
        accountId,
        status: "pending_magic_link",
        flow: "user_email_manual_activation",
        step: "request_magiclink",
        email: emailInput.value,
        linkDeliveredTo: emailInput.value,
        linkSource: "mailbox_or_user_input",
        linkTrusted: false,
        deliveryAccepted: true,
        deliveryConfirmed: false,
        deliveryStatus: send.deliveryStatus || "provider_accepted",
        codeOrder: send.codeOrder,
        magicLinkRequired: true,
        message: "Provider menerima permintaan magic link. Delivery email belum dapat dikonfirmasi oleh portal; buka inbox email kamu dan tempel link terbaru. Jika email belum masuk, gunakan tombol Kirim Ulang.",
      };

      if (idempotencyEnabled) {
        await finalizeGenerationRequest(req.user.id, idempotencyKey, "completed", 200, body);
        idempotencyFinalized = true;
      }

      return res.json(body);
    } catch (error) {
      console.error("[REQUEST MAGIC LINK ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });

      if (idempotencyEnabled && !idempotencyFinalized) {
        try {
          await finalizeGenerationRequest(req.user.id, idempotencyKey, "failed", error?.status || (error?.name === "AbortError" ? 504 : 500), {
            ok: false,
            code: error?.code || "MAGIC_LINK_REQUEST_FAILED",
            error: error?.message || "Backend/provider request failed.",
            accountId,
          });
        } catch {}
      }

      if (accountId) {
        try {
          await supabase.from("am_generated_accounts").update({ status: "failed", provider_message: "Backend/provider request failed." }).eq("id", accountId).eq("user_id", req.user.id);
        } catch {}
      }

      const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : error?.name === "AbortError" ? 504 : 500;
      return res.status(status).json({ ok: false, code: error?.code || "MAGIC_LINK_REQUEST_FAILED", error: error?.status ? error.message : "Terjadi kesalahan saat mengirim magic link.", accountId });
    }
  }
);


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
   HTML PAGE ROUTES

   Keep the public URLs stable while the source files live under
   public/html/. CSS and JS remain under their dedicated folders.
========================================================= */

const HTML_DIR = path.join(__dirname, "public", "html");

function sendPage(file) {
  return (_req, res) => {
    res.sendFile(file, {
      root: HTML_DIR,
    });
  };
}

app.get("/", sendPage("index.html"));
app.get("/index.html", sendPage("index.html"));
app.get("/login.html", sendPage("login.html"));
app.get("/home.html", sendPage("home.html"));
app.get("/dashboard.html", sendPage("dashboard.html"));
app.get("/setting.html", sendPage("setting.html"));
app.get("/reset-password.html", sendPage("reset-password.html"));

/* =========================================================
   AUTH PAGES
========================================================= */

app.get("/login", sendPage("login.html"));

app.get("/reset-password", sendPage("reset-password.html"));

/* =========================================================
   OWNER PAGE
========================================================= */

app.get("/owner", (_req, res) => {
  return res.redirect(302, "/owner.html");
});

app.get("/owner.html", sendPage("owner.html"));

/* =========================================================
   API 404
========================================================= */

app.use(
  "/api",
  (_req, res) => {
    return res
      .status(404)
      .json({
        ok: false,

        error:
          "API endpoint tidak ditemukan.",
      });
  }
);

/* =========================================================
   FINAL 404

   This app uses explicit page routes rather than a client-side SPA
   fallback. Returning index.html for an unknown asset would hide real
   404s and can return HTML with a 200 status for missing CSS/JS files.
========================================================= */

app.use((req, res) => {
  if (req.accepts("html")) {
    return res.status(404).send("<!doctype html><html lang=\"id\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>404 • Jyy'R Amprem</title></head><body style=\"font-family:system-ui;background:#08060d;color:#fff;display:grid;place-items:center;min-height:100vh\"><main><h1>404</h1><p>Halaman tidak ditemukan.</p><a href=\"/\" style=\"color:#b58cff\">Kembali ke beranda</a></main></body></html>");
  }
  return res.status(404).json({ ok: false, error: "Resource tidak ditemukan." });
});


/* =========================================================
   SERVER / VERCEL SERVERLESS
========================================================= */

let server = null;

if (!process.env.VERCEL) {
  server = app.listen(
    PORT,
    () => {
      console.log(
        `AM Account Portal V4.2 running on http://localhost:${PORT}`
      );
    }
  );
}

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

function shutdown(signal) {
  console.log(
    `[SERVER] ${signal} received.`
  );

  if (!server) {
    console.log(
      "[SERVER] No local HTTP server to close."
    );

    process.exit(0);
  }

  server.close(() => {
    console.log(
      "[SERVER] HTTP server closed."
    );

    process.exit(0);
  });
}

if (server) {
  process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
  );

  process.on(
    "SIGINT",
    () => shutdown("SIGINT")
  );
}

/* =========================================================
   VERCEL / SERVERLESS EXPORT
========================================================= */

export default app;
