import crypto from "node:crypto";
import runtime from "../../lib/runtime/app-runtime.js";

const {
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
  FINAL_MAGIC_FLOW,
  supabase,
  assertEmailVerificationConfig,
  verificationRequestHash,
  supabaseAuth,
  publicUser,
  findPendingEmailVerification,
  semverParts,
  APP_RELEASE_PACKAGE,
  APP_RELEASE_BUCKET,
  APP_RELEASE_MAX_BYTES,
  releaseDownloadUrl,
  readStoredApk,
  verifyStoredApk,
  removeStorageObject,
  PORTAL_ACCESS_EXEMPT_PATHS,
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
  TOKEN_CENTER_URL,
  ECOSYSTEM_HANDOFF_SECRET,
  OWNER_WHATSAPP_URL,
  isPortalAccessExempt,
  hasPortalAccess,
  getMemberStatus,
  restrictedMemberResponse,
  isOwner,
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
  generateLimiter,
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
  confirmMagicLinkLimiter,
  normalizeIdempotencyKey,
  hashIdempotencyKey,
  claimGenerationRequest,
  finalizeGenerationRequest,
  reserveProviderRequest,
  recordProviderRequestResult,
  consumeMagicLinkQuota,
  resendMagicLinkLimiter,
  sendSignupVerificationEmail,
  HTML_DIR,
  sendPage
} = runtime;

export function registerPortalTokenRoutes(app, deps) {
  const {
    authRegisterLimiter,
    authResendLimiter,
    authVerifyLimiter,
    portalTokenVerifyLimiter,
    ownerClaimLimiter,
    ownerReadLimiter,
    ownerStatisticsLimiter,
    ownerMemberReadLimiter,
    ownerBroadcastMutationLimiter,
    ownerBroadcastReadLimiter,
    ownerMemberMutationLimiter,
    portalTokenPublicLimiter,
    providerDiagnosticLimiter,
    requireAuth,
    requireOwner
  } = deps;

  app.get("/api/access/status", requireAuth, async (req, res) => {
    try {
      const status = await getMemberStatus(req.user.id);
      const access = status.status === "active" && await hasPortalAccess(req.user.id);
      const owner = await isOwner(req.user.id);

      // Token lifetime is read from the token itself. The grant has a separate
      // The RPC returns the user's access expiry, not the token redemption window.
      const tokenLifetime = await getPortalTokenLifetime(req.user.id);


      return res.json({
        ok: true,
        access,
        owner,
        status: status.status,
        reason: status.status_reason || null,
        tokenLifetime,
        token_lifetime: tokenLifetime,
      });
    } catch (error) {
      console.error("[PORTAL ACCESS STATUS ERROR]", error);
      return res.status(500).json({ ok: false, access: false, tokenLifetime: null, token_lifetime: null, error: "Gagal memeriksa akses portal." });
    }
  });

  app.get("/api/access/contact-owner", requireAuth, async (req, res) => {
    try {
      if (!OWNER_WHATSAPP_URL) {
        return res.status(503).json({ ok: false, error: "WhatsApp Owner belum dikonfigurasi di server." });
      }

      const url = new URL(OWNER_WHATSAPP_URL);
      const user = String(req.user?.email || "").trim();
      const message = user
        ? `Halo Owner, saya membutuhkan Token Akses Portal Jyy'R Amprem. Email akun: ${user}`
        : "Halo Owner, saya membutuhkan Token Akses Portal Jyy'R Amprem.";
      url.searchParams.set("text", message);

      return res.json({ ok: true, whatsappUrl: url.toString() });
    } catch (error) {
      console.error("[PORTAL OWNER CONTACT ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, error: "Gagal menyiapkan kontak Owner." });
    }
  });

  app.post("/api/access/verify", requireAuth, portalTokenVerifyLimiter, async (req, res) => {
    try {
      const token = normalizePortalToken(req.body?.token);
      if (!/^[A-F0-9]{20}$/.test(token)) return res.status(400).json({ ok: false, valid: false, error: "Format token tidak valid." });

      const { data, error } = await db.rpc("portal_verify_token", { p_user_id: req.user.id, p_token_hash: hashPortalToken(token) });
      if (error) {
        const message = String(error.message || "");
        if (/already used|revoked|expired/i.test(message)) return res.status(409).json({ ok: false, valid: false, code: "TOKEN_UNAVAILABLE", error: /expired/i.test(message) ? "Token sudah kedaluwarsa." : "Token sudah digunakan atau dicabut." });
        if (/not available/i.test(message)) return res.status(409).json({ ok: false, valid: false, code: "TOKEN_NOT_PUBLISHED", error: "Token belum dipublikasikan." });
        if (/invalid/i.test(message)) return res.status(401).json({ ok: false, valid: false, error: "Token salah atau tidak valid." });
        return res.status(500).json({ ok: false, valid: false, error: "Gagal memverifikasi token." });
      }
      return res.json({
        ok: true,
        valid: data?.valid === true,
        redemptionExpiresAt: data?.redemption_expires_at || null,
        accessExpiresAt: data?.access_expires_at || null,
        durationMode: data?.duration_mode || "legacy",
        assignedUserId: data?.assigned_user_id || null,
      });
    } catch (error) {
      console.error("[PORTAL TOKEN VERIFY ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, valid: false, error: "Gagal memverifikasi token." });
    }
  });


  app.post("/api/access/token-center-link", requireAuth, portalTokenPublicLimiter, async (req, res) => {
    try {
      if (!TOKEN_CENTER_URL) return res.status(503).json({ ok: false, error: "JYY'R Token belum dikonfigurasi." });
      if (!ECOSYSTEM_HANDOFF_SECRET || ECOSYSTEM_HANDOFF_SECRET.length < 32) {
        return res.status(503).json({ ok: false, error: "Auth handoff belum dikonfigurasi dengan aman." });
      }
      const state = crypto.randomBytes(32).toString("base64url");
      const stateHash = crypto.createHash("sha256").update(state).digest("hex");
      const { error } = await db.from("jyyr_ecosystem_handoffs").insert({
        state_hash: stateHash,
        user_id: req.user.id,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      if (error) throw error;
      const url = new URL(TOKEN_CENTER_URL);
      url.searchParams.set("state", state);
      return res.json({ ok: true, url: url.toString() });
    } catch (error) {
      console.error("[TOKEN CENTER HANDOFF CREATE ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, error: "Gagal menyiapkan akses JYY'R Token." });
    }
  });

  app.post("/api/ecosystem/handoff/inspect", portalTokenPublicLimiter, async (req, res) => {
    try {
      const providedSecret = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
      if (!ECOSYSTEM_HANDOFF_SECRET || !providedSecret || providedSecret.length !== ECOSYSTEM_HANDOFF_SECRET.length || !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(ECOSYSTEM_HANDOFF_SECRET))) {
        return res.status(401).json({ ok: false, authenticated: false });
      }
      const state = String(req.body?.state || "").trim();
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(state)) return res.status(400).json({ ok: false, authenticated: false });
      const stateHash = crypto.createHash("sha256").update(state).digest("hex");
      const { data, error } = await db.from("jyyr_ecosystem_handoffs").select("user_id,expires_at,used_at").eq("state_hash", stateHash).maybeSingle();
      if (error) throw error;
      if (!data || data.used_at || new Date(data.expires_at).getTime() <= Date.now()) return res.json({ ok: true, authenticated: false });
      const profile = await db.from("member_profiles").select("username").eq("user_id", data.user_id).maybeSingle();
      return res.json({ ok: true, authenticated: true, username: profile?.data?.username || null });
    } catch (error) {
      console.error("[TOKEN CENTER HANDOFF INSPECT ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, authenticated: false });
    }
  });

  app.post("/api/ecosystem/handoff/consume", portalTokenPublicLimiter, async (req, res) => {
    try {
      const providedSecret = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
      if (!ECOSYSTEM_HANDOFF_SECRET || !providedSecret || providedSecret.length !== ECOSYSTEM_HANDOFF_SECRET.length || !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(ECOSYSTEM_HANDOFF_SECRET))) {
        return res.status(401).json({ ok: false, authenticated: false });
      }
      const state = String(req.body?.state || "").trim();
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(state)) return res.status(400).json({ ok: false, authenticated: false });
      const stateHash = crypto.createHash("sha256").update(state).digest("hex");
      const { data, error } = await db.from("jyyr_ecosystem_handoffs").select("id,user_id,expires_at,used_at").eq("state_hash", stateHash).maybeSingle();
      if (error) throw error;
      if (!data || data.used_at || new Date(data.expires_at).getTime() <= Date.now()) return res.json({ ok: true, authenticated: false });
      const now = new Date().toISOString();
      const { data: consumed, error: updateError } = await db.from("jyyr_ecosystem_handoffs").update({ used_at: now }).eq("id", data.id).is("used_at", null).gt("expires_at", now).select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!consumed) return res.json({ ok: true, authenticated: false });
      const profile = await db.from("member_profiles").select("username").eq("user_id", data.user_id).maybeSingle();
      return res.json({ ok: true, authenticated: true, user_id: data.user_id, username: profile?.data?.username || null });
    } catch (error) {
      console.error("[TOKEN CENTER HANDOFF CONSUME ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, authenticated: false });
    }
  });

  app.get("/api/owner/token/status", requireAuth, ownerReadLimiter, requireOwner, async (req, res) => {
    try {
      const { data, error } = await db.rpc("owner_get_portal_token_status", { p_owner_user_id: req.user.id });
      if (error) throw error;
      return res.json({
        ok: true,
        owner: true,
        token: data?.token || { status: "none" },
        available_count: Number(data?.available_count || 0),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, owner: true, error: "Gagal membaca status token." });
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
      const tokenHash = hashPortalToken(token);
      const tokenPreview = `${token.slice(0, 4)}••••${token.slice(-4)}`;
      const tokenEncrypted = encryptPortalToken(token);

      // Owner-generated tokens are unassigned at creation. The first successful
      // redemption transaction assigns the token to exactly one member.
      const { data, error } = await db.rpc("owner_create_portal_token", {
        p_owner_user_id: req.user.id,
        p_token_hash: tokenHash,
        p_token_preview: tokenPreview,
        p_token_encrypted: tokenEncrypted,
        p_duration_mode: durationMode,
      });

      if (error) throw error;
      if (!data?.id) throw Object.assign(new Error("Token ID tidak dikembalikan database."), { code: "PORTAL_TOKEN_ID_MISSING", status: 500 });

      if (!data.redemption_expires_at) {
        throw Object.assign(new Error("Database tidak mengembalikan redemption_expires_at canonical."), { code: "PORTAL_TOKEN_REDEMPTION_EXPIRY_MISSING", status: 500 });
      }
      if (!data.token_encrypted) {
        throw Object.assign(new Error("Database tidak mengembalikan token_encrypted canonical."), { code: "PORTAL_TOKEN_ENCRYPTED_NOT_PERSISTED", status: 500 });
      }

      const persisted = {
        id: data.id,
        created_at: data.created_at,
        redemption_expires_at: data.redemption_expires_at,
        duration_mode: data.duration_mode,
        token_encrypted: data.token_encrypted,
      };

      if (!persisted.created_at || !persisted.duration_mode) {
        throw Object.assign(new Error("Database tidak mengembalikan metadata token canonical lengkap."), { code: "PORTAL_TOKEN_CANONICAL_METADATA_MISSING", status: 500 });
      }

      rememberRecentOwnerPortalToken(req.user.id, data.id, token, persisted.redemption_expires_at);
      return res.status(201).json({
        ok: true,
        owner: true,
        token,
        tokenId: data.id,
        createdAt: persisted.created_at,
        redemptionExpiresAt: persisted.redemption_expires_at,
        accessExpiresAt: null,
        durationMode: persisted.duration_mode,
        durationLabel: getPortalTokenDurationLabel(persisted.duration_mode),
        assignedUserId: data.assigned_user_id || null,
      });
    } catch (error) {
      console.error("[OWNER TOKEN GENERATE ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, error: "Gagal membuat token." });
    }
  });


  app.post("/api/owner/token/generate-batch", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
    try {
      const quantity = Number(req.body?.quantity ?? 1);
      const durationMode = normalizePortalTokenDuration(req.body?.duration_mode || req.body?.durationMode);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        return res.status(400).json({ ok: false, code: "INVALID_GENERATE_QUANTITY", error: "Jumlah generate harus 1 sampai 1000 per proses." });
      }
      if (!durationMode) return res.status(400).json({ ok: false, code: "INVALID_PORTAL_TOKEN_MODE", error: "Mode token tidak valid." });
      let created = 0;
      let latest = null;
      for (let i = 0; i < quantity; i += 1) {
        const token = generatePortalToken();
        const tokenHash = hashPortalToken(token);
        const tokenPreview = `${token.slice(0, 4)}••••${token.slice(-4)}`;
        const tokenEncrypted = encryptPortalToken(token);
        const { data, error } = await db.rpc("owner_create_portal_token", {
          p_owner_user_id: req.user.id,
          p_token_hash: tokenHash,
          p_token_preview: tokenPreview,
          p_token_encrypted: tokenEncrypted,
          p_duration_mode: durationMode,
        });
        if (error) throw error;
        created += 1;
        latest = { token, tokenId: data?.id || null, createdAt: data?.created_at || null, redemptionExpiresAt: data?.redemption_expires_at || null, durationMode: data?.duration_mode || durationMode };
      }
      if (latest?.tokenId && latest?.token) rememberRecentOwnerPortalToken(req.user.id, latest.tokenId, latest.token, latest.redemptionExpiresAt);
      return res.status(201).json({ ok: true, createdCount: created, ...latest });
    } catch (error) {
      console.error("[OWNER TOKEN BATCH GENERATE ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
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
      const { data: rows, error } = await db.from("portal_access_tokens")
        .select("id, token_preview, token_encrypted, duration_mode, status, created_at, redemption_expires_at, published_at, published_by, assigned_user_id, used_at, revoked_at")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;

      const { count: total, error: countError } = await db.from("portal_access_tokens")
        .select("id", { count: "exact", head: true });
      if (countError) throw countError;

      // The token history UI needs the email of the member who actually used a
      // token. That relationship lives in portal_access_grants, while emails
      // live in Supabase Auth, so resolve only the users referenced by the
      // current page instead of loading the entire Auth user table.
      const tokenIds = (Array.isArray(rows) ? rows : []).map((row) => row.id).filter(Boolean);
      let grants = [];
      const usedEmailByTokenId = new Map();
      if (tokenIds.length) {
        const { data: grantRows, error: grantsError } = await db.from("portal_access_grants")
          .select("token_id, user_id, granted_at, access_expires_at, last_verified_at")
          .in("token_id", tokenIds);
        if (grantsError) throw grantsError;
        grants = Array.isArray(grantRows) ? grantRows : [];

        const userIds = [...new Set(grants.map((grant) => grant.user_id).filter(Boolean))];
        const usersById = new Map();
        for (const userId of userIds) {
          try {
            const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
            if (!userError && userData?.user?.email) usersById.set(userId, userData.user.email);
          } catch (userError) {
            console.error("[OWNER TOKEN HISTORY USER LOOKUP ERROR]", { userId, message: userError?.message || "Unknown error" });
          }
        }

        for (const grant of grants) {
          const email = usersById.get(grant.user_id);
          if (email && !usedEmailByTokenId.has(grant.token_id)) usedEmailByTokenId.set(grant.token_id, email);
        }
      }

      const tokens = (Array.isArray(rows) ? rows : []).map((row) => {
        const grant = grants.find((item) => item.token_id === row.id) || null;
        const safeRow = {
          id: row.id,
          preview: row.token_preview || null,
          duration_mode: row.duration_mode || "legacy",
          duration_label: getPortalTokenDurationLabel(row.duration_mode),
          status: row.status === "active" && row.redemption_expires_at && new Date(row.redemption_expires_at).getTime() <= Date.now() ? "expired" : row.status,
          created_at: row.created_at,
          redemption_expires_at: row.redemption_expires_at,
          assigned_user_id: row.assigned_user_id || null,
          assigned_email: usedEmailByTokenId.get(row.id) || null,
          access_expires_at: grant?.access_expires_at || null,
          access_granted_at: grant?.granted_at || null,
          used_at: row.used_at,
          revoked_at: row.revoked_at,
          published_at: row.published_at,
          published_by: row.published_by,
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


  app.post("/api/owner/token/publish", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
    try {
      if (!isUuid(req.body?.token_id)) return res.status(400).json({ ok: false, code: "INVALID_TOKEN_ID", error: "Token ID tidak valid." });
      const { data, error } = await db.rpc("owner_publish_portal_token", { p_owner_user_id: req.user.id, p_token_id: req.body.token_id });
      if (error) {
        const message = String(error.message || "");
        if (/Daily publish quota exhausted/i.test(message)) return res.status(429).json({ ok: false, code: "PUBLISH_QUOTA_EXHAUSTED", error: "Quota distribusi hari ini sudah mencapai 5/5." });
        if (/not publishable/i.test(message)) return res.status(409).json({ ok: false, code: "TOKEN_NOT_PUBLISHABLE", error: "Token tidak dapat dipublikasikan." });
        throw error;
      }
      return res.json({ ok: true, ...data });
    } catch (error) {
      console.error("[OWNER TOKEN PUBLISH ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, error: "Gagal menyebarkan token." });
    }
  });

  app.post("/api/owner/token/unpublish", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
    try {
      if (!isUuid(req.body?.token_id)) return res.status(400).json({ ok: false, error: "Token ID tidak valid." });
      const { data, error } = await db.rpc("owner_unpublish_portal_token", { p_owner_user_id: req.user.id, p_token_id: req.body.token_id });
      if (error) throw error;
      return res.json({ ok: true, unpublished: data === true });
    } catch (error) {
      console.error("[OWNER TOKEN UNPUBLISH ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, error: "Gagal menghentikan publikasi token." });
    }
  });

  app.get("/api/owner/token/distribution-status", requireAuth, ownerReadLimiter, requireOwner, async (_req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: quota, error: quotaError }, { count: inventoryCount, error: inventoryError }] = await Promise.all([
        db.from("portal_daily_distribution_quota").select("calendar_date,publish_count").eq("calendar_date", today).maybeSingle(),
        db.from("portal_access_tokens").select("id", { count: "exact", head: true }).eq("status", "active").is("published_at", null),
      ]);
      if (quotaError) throw quotaError;
      if (inventoryError) throw inventoryError;
      const publishedToday = Number(quota?.publish_count || 0);
      return res.json({ ok: true, calendarDate: today, publishedToday, limit: 5, remaining: Math.max(0, 5 - publishedToday), unpublishedInventory: Number(inventoryCount || 0) });
    } catch (error) {
      console.error("[OWNER TOKEN DISTRIBUTION STATUS ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, error: "Gagal membaca quota distribusi token." });
    }
  });

  app.post("/api/owner/token/revoke", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
    try {
      if (!isUuid(req.body?.token_id)) return res.status(400).json({ ok: false, error: "Token ID tidak valid." });
      const { data, error } = await db.rpc("owner_revoke_portal_token", { p_owner_user_id: req.user.id, p_token_id: req.body.token_id });
      if (error) throw error;
      return res.json({ ok: true, owner: true, revoked: data === true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: "Gagal mencabut token." });
    }
  });
}
