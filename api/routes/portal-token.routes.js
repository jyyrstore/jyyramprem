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
        const invalid = /invalid|expired/i.test(String(error.message || ""));
        return res.status(invalid ? 401 : 500).json({ ok: false, valid: false, error: invalid ? "Token salah atau sudah kedaluwarsa." : "Gagal memverifikasi token." });
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

  app.get("/api/owner/token/history", requireAuth, ownerReadLimiter, requireOwner, async (req, res) => {
    try {
      const limit = parsePositiveInt(req.query.limit, 50, 100);
      const offset = parsePositiveInt(req.query.offset, 0, 1000000);
      if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Pagination tidak valid." });

      // Read directly from the trusted service-role client. This avoids the
      // historical owner_list_portal_tokens overloads that can omit the
      // encrypted field and cause a token to disappear after refresh.
      const { data: rows, error } = await db.from("portal_access_tokens")
        .select("id, token_preview, token_encrypted, duration_mode, status, created_at, redemption_expires_at, assigned_user_id, used_at, revoked_at")
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
      const { data, error } = await db.rpc("owner_revoke_portal_token", { p_owner_user_id: req.user.id, p_token_id: req.body.token_id });
      if (error) throw error;
      return res.json({ ok: true, owner: true, revoked: data === true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: "Gagal mencabut token." });
    }
  });
}
