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

export function registerMemberRoutes(app, deps) {
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

  app.get('/api/notifications', requireAuth, ownerBroadcastReadLimiter, async(req,res)=>{try{const limit=parsePositiveInt(req.query.limit,20,50),offset=parsePositiveInt(req.query.offset,0,1000000);if(limit===null||offset===null)return res.status(400).json({ok:false,error:'Pagination tidak valid.'});const {data,error}=await db.rpc('member_list_notifications',{p_user_id:req.user.id,p_limit:limit,p_offset:offset});if(error)throw error;return res.json({ok:true,...data});}catch(e){return res.status(/User not found/i.test(String(e.message))?404:500).json({ok:false,error:'Gagal membaca notifikasi.'});}});

  app.post('/api/notifications/:id/read', requireAuth, ownerMemberMutationLimiter, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'Notification ID tidak valid.'});const {data,error}=await db.rpc('member_mark_notification_read',{p_user_id:req.user.id,p_id:req.params.id});if(error)throw error;return res.json({ok:true,notification:data});}catch(e){return res.status(/not found/i.test(String(e.message))?404:500).json({ok:false,error:'Gagal menandai notifikasi.'});}});

  app.get('/api/messages', requireAuth, ownerBroadcastReadLimiter, async(req,res)=>{try{const limit=parsePositiveInt(req.query.limit,20,50),offset=parsePositiveInt(req.query.offset,0,1000000);const {data,error}=await db.rpc('member_list_conversations',{p_user_id:req.user.id,p_limit:limit,p_offset:offset});if(error)throw error;return res.json({ok:true,...data});}catch(e){return res.status(500).json({ok:false,error:'Gagal membaca percakapan.'});}});

  app.get('/api/messages/:conversationId', requireAuth, ownerBroadcastReadLimiter, async(req,res)=>{try{if(!isUuid(req.params.conversationId))return res.status(400).json({ok:false,error:'Conversation ID tidak valid.'});const {data,error}=await db.rpc('member_get_conversation',{p_user_id:req.user.id,p_conversation_id:req.params.conversationId,p_limit:100,p_offset:0});if(error)throw error;return res.json({ok:true,...data});}catch(e){return res.status(/Conversation not found/i.test(String(e.message))?404:500).json({ok:false,error:'Gagal membaca percakapan.'});}});

  app.post('/api/messages/:conversationId', requireAuth, ownerMemberMutationLimiter, async(req,res)=>{try{if(!isUuid(req.params.conversationId))return res.status(400).json({ok:false,error:'Conversation ID tidak valid.'});const body=typeof req.body?.body==='string'?req.body.body.trim():'';if(!body||body.length>10000)return res.status(400).json({ok:false,error:'Isi pesan tidak valid.'});const {data,error}=await db.rpc('member_send_message',{p_user_id:req.user.id,p_conversation_id:req.params.conversationId,p_body:body});if(error)throw error;return res.status(201).json({ok:true,message:data});}catch(e){return res.status(/Conversation not found/i.test(String(e.message))?404:500).json({ok:false,error:'Gagal mengirim pesan.'});}});

  app.post('/api/messages/:conversationId/read', requireAuth, ownerMemberMutationLimiter, async(req,res)=>{try{if(!isUuid(req.params.conversationId))return res.status(400).json({ok:false,error:'Conversation ID tidak valid.'});const {data,error}=await db.rpc('member_mark_messages_read',{p_user_id:req.user.id,p_conversation_id:req.params.conversationId});if(error)throw error;return res.json({ok:true,updated:data});}catch(e){return res.status(500).json({ok:false,error:'Gagal menandai pesan.'});}});

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
        const { data: account, error: accountError } = await db.from("am_generated_accounts")
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

        const { error: updateError } = await db.from("am_generated_accounts")
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

        await db.from("am_generation_logs").insert({
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
        const { data: account, error: accountError } = await db.from("am_generated_accounts")
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
          await db.from("am_generated_accounts").update({ provider_id_token_encrypted: null, provider_token_expires_at: null }).eq("id", accountId).eq("user_id", req.user.id);
          return res.status(409).json({ ok: false, verified: true, premiumApplied: false, code: "PROVIDER_TOKEN_EXPIRED", error: "Sesi verifikasi sudah kedaluwarsa. Minta dan tempel magic link terbaru." });
        }

        const email = normalizeUserEmail(account.email);
        if (!email.valid) return res.status(409).json({ ok: false, error: "Email account tidak valid." });
        const idToken = decryptProviderIdToken(account.provider_id_token_encrypted);
        const claims = decodeJwtPayloadSafe(idToken);
        const tokenEmail = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!claims || tokenEmail !== email.value || claims.email_verified !== true || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= nowSeconds) {
          await db.from("am_generated_accounts").update({ provider_id_token_encrypted: null, provider_token_expires_at: null }).eq("id", accountId).eq("user_id", req.user.id);
          return res.status(409).json({ ok: false, verified: false, premiumApplied: false, code: "PROVIDER_TOKEN_INVALID", error: "Sesi provider tidak valid atau sudah kedaluwarsa. Ulangi verifikasi magic link terbaru." });
        }

        // Atomically claim this account before calling the provider. This is the
        // server-side concurrency guard; frontend button disabling is only UX.
        const activationClaimToken = crypto.randomBytes(32).toString("hex");
        const { data: claimRows, error: claimError } = await db.rpc("claim_premium_activation", {
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
            await db.rpc("release_premium_activation_claim", {
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
        const { data: finalizedRows, error: updateError } = await db.from("am_generated_accounts")
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

        await db.from("am_generation_logs").insert({
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
        } = await db.from(
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
        } = await db.from("am_magic_link_quota_usage")
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

  app.get("/api/accounts/:id/magiclink-status", requireAuth, async (req, res) => {
    const accountId = String(req.params.id || "").trim();
    if (!isUuid(accountId)) return res.status(400).json({ ok: false, error: "Account ID tidak valid." });
    try {
      const { data, error } = await db.from("am_generated_accounts")
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

  app.post("/api/accounts/:id/send-magiclink", requireAuth, resendMagicLinkLimiter, async (req, res) => {
    const accountId = String(req.params.id || "").trim();
    if (!isUuid(accountId)) return res.status(400).json({ ok: false, error: "Account ID tidak valid." });
    try {
      const { data: account, error: accountError } = await db.from("am_generated_accounts")
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
        await db.from("am_generated_accounts").update({
          magic_link_delivery_status: "delivery_failed",
          magic_link_last_error: "Provider gagal menerima request magic link baru.",
          provider_status_code: send.status,
          provider_response: sanitizeProviderResponse(send.data),
        }).eq("id", accountId).eq("user_id", req.user.id);
        return res.status(send.status && send.status >= 400 ? send.status : 502).json({ ok: false, code: send.reason, error: "Provider gagal menerima permintaan magic link baru." });
      }

      const requestedAt = new Date().toISOString();
      const { error: updateError } = await db.from("am_generated_accounts").update({
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

      await db.from("am_generation_logs").insert({
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
          const { data: account, error: insertError } = await db.from("am_generated_accounts")
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
          const { error: existingUpdateError } = await db.from("am_generated_accounts")
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
          await db.from("am_generated_accounts").update({ status: "failed", provider_message: body.error }).eq("id", accountId).eq("user_id", req.user.id);
          if (idempotencyEnabled) {
            await finalizeGenerationRequest(req.user.id, idempotencyKey, "failed", 429, body);
            idempotencyFinalized = true;
          }
          return res.status(429).json(body);
        }

        const send = await callProviderSendMagicLink({ providerBase, providerKey, email: emailInput.value });
        await recordProviderRequestResult(today, PROVIDER_SEND_MAGICLINK_PATH, send.attempted && send.status !== null ? send.ok : false);

        if (!send.ok) {
          await db.from("am_generated_accounts").update({
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
          await db.from("am_generated_accounts").update({
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
        const { error: updateError } = await db.from("am_generated_accounts").update({
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

        await db.from("am_generation_logs").insert({
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
            await db.from("am_generated_accounts").update({ status: "failed", provider_message: "Backend/provider request failed." }).eq("id", accountId).eq("user_id", req.user.id);
          } catch {}
        }

        const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : error?.name === "AbortError" ? 504 : 500;
        return res.status(status).json({ ok: false, code: error?.code || "MAGIC_LINK_REQUEST_FAILED", error: error?.status ? error.message : "Terjadi kesalahan saat mengirim magic link.", accountId });
      }
    }
  );
}
