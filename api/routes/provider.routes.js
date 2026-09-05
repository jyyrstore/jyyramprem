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

export function registerProviderRoutes(app, deps) {
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
        ({ data, error } = await db.from("am_generated_accounts")
          .update(deliveryUpdate)
          .eq("email", email.value)
          .eq("magic_link_code_order", codeOrder)
          .eq("email_verification_status", "pending")
          .select("id")
          .limit(1));
      } else {
        ({ data, error } = await db.from("am_generated_accounts")
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
        await db.from("am_generation_logs").insert({
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
}
