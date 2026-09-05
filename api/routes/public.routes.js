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

export function registerPublicRoutes(app, deps) {
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

  app.get('/api/maintenance', async(_req,res)=>{try{const {data,error}=await db.rpc('public_get_maintenance');if(error)throw error;return res.json({ok:true,...data});}catch(e){console.error('[MAINTENANCE ERROR]',e);return res.status(500).json({ok:false,error:'Maintenance status unavailable.'});}});

  app.get('/api/faq', ownerBroadcastReadLimiter, async (_req, res) => {
    try {
      const { data, error } = await db.rpc('public_list_faq');
      if (error) throw error;
      return res.json({ ok: true, faq: Array.isArray(data?.faq) ? data.faq : Array.isArray(data) ? data : [] });
    } catch (e) {
      console.error('[PUBLIC FAQ ERROR]', e);
      return res.status(500).json({ ok: false, error: 'FAQ belum dapat dimuat.' });
    }
  });

  app.get('/api/help', ownerBroadcastReadLimiter, async (_req, res) => {
    try {
      const { data, error } = await db.rpc('public_list_help');
      if (error) throw error;
      return res.json({ ok: true, help: Array.isArray(data?.help) ? data.help : Array.isArray(data) ? data : [] });
    } catch (e) {
      console.error('[PUBLIC HELP ERROR]', e);
      return res.status(500).json({ ok: false, error: 'Help Center belum dapat dimuat.' });
    }
  });

  app.get(
    "/api/health",
    async (_req, res) => {
      try {
        const {
          error,
        } = await db.from(
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

  app.post('/api/internal/maintenance/cleanup-idempotency', async (req, res) => {
    const expected = String(process.env.CRON_SECRET || '').trim();
    const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!expected || !timingSafeSecretEquals(provided, expected)) return res.status(401).json({ ok:false, error:'Unauthorized.' });
    try {
      const { data, error } = await db.rpc('cleanup_am_generation_idempotency');
      if (error) throw error;
      return res.json({ ok:true, removed:Number(data||0) });
    } catch (e) {
      console.error('[IDEMPOTENCY CLEANUP ERROR]', e);
      return res.status(500).json({ ok:false, error:'Cleanup gagal.' });
    }
  });

  app.get("/manifest.webmanifest", (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.sendFile("manifest.webmanifest", { root: path.join(__dirname, "public") });
  });

  app.get("/service-worker.js", (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.sendFile("service-worker.js", { root: path.join(__dirname, "public") });
  });

  app.get("/", sendPage("index.html"));

  app.get("/index.html", sendPage("index.html"));

  app.get("/login.html", sendPage("login.html"));

  app.get("/home.html", sendPage("home.html"));

  app.get("/dashboard.html", sendPage("dashboard.html"));

  app.get("/setting.html", sendPage("setting.html"));

  app.get("/reset-password.html", sendPage("reset-password.html"));

  app.get("/help.html", sendPage("help.html"));

  app.get("/login", sendPage("login.html"));

  app.get("/reset-password", sendPage("reset-password.html"));

  app.get("/owner", (_req, res) => {
    return res.redirect(302, "/owner.html");
  });

  app.get("/owner.html", sendPage("owner.html"));
}
