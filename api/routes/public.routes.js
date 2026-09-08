import { PUBLIC_DIR } from "../../lib/config/app.config.js";
import runtime from "../../lib/runtime/app-runtime.js";

const {
  db,
  env,
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  getPortalTokenDurationLabel,
  portalTokenPublicLimiter,
  decryptPortalToken,
  timingSafeSecretEquals,
  parsePositiveInt,
  isUuid
} = runtime;

export function registerPublicRoutes(app, deps) {
  const {
    ownerBroadcastReadLimiter,
  } = deps;


  app.get("/api/public/tokens", portalTokenPublicLimiter, async (req, res) => {
    try {
      const limit = parsePositiveInt(req.query.limit, 20, 50);
      const offset = parsePositiveInt(req.query.offset, 0, 1000000);
      if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Pagination tidak valid." });

      await db.from("portal_access_tokens")
        .update({ status: "expired" })
        .eq("status", "active")
        .is("assigned_user_id", null)
        .is("used_at", null)
        .not("published_at", "is", null)
        .lte("redemption_expires_at", new Date().toISOString());

      const { count, error: countError } = await db.from("portal_access_tokens")
        .select("id", { count: "exact", head: true })
        .not("published_at", "is", null);
      if (countError) throw countError;

      const { data: rows, error } = await db.from("portal_access_tokens")
        .select("id, token_preview, token_encrypted, duration_mode, status, created_at, redemption_expires_at, published_at, used_at, assigned_user_id")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;

      const tokenIds = (rows || []).map((row) => row.id).filter(Boolean);
      let grants = [];
      if (tokenIds.length) {
        const { data: grantRows, error: grantError } = await db.from("portal_access_grants")
          .select("token_id,access_expires_at,granted_at")
          .in("token_id", tokenIds);
        if (grantError) throw grantError;
        grants = Array.isArray(grantRows) ? grantRows : [];
      }
      const userIds = [...new Set((rows || []).map((row) => row.assigned_user_id).filter(Boolean))];
      const usernames = new Map();
      if (userIds.length) {
        const { data: profiles, error: profileError } = await db.from("member_profiles")
          .select("user_id,username")
          .in("user_id", userIds);
        if (profileError) throw profileError;
        for (const profile of profiles || []) if (profile.username) usernames.set(profile.user_id, profile.username);
      }

      const tokens = (rows || []).map((row) => {
        let token = null;
        try { token = decryptPortalToken(row.token_encrypted); } catch (e) {
          console.error("[PUBLIC TOKEN DECRYPT ERROR]", { tokenId: row.id, code: e?.code || null });
        }
        const grant = grants.find((item) => item.token_id === row.id) || null;
        const status = row.status === "active" && row.redemption_expires_at && new Date(row.redemption_expires_at).getTime() <= Date.now() ? "expired" : row.status;
        return {
          id: row.id,
          token: token,
          status,
          duration: row.duration_mode || "legacy",
          duration_label: getPortalTokenDurationLabel(row.duration_mode),
          claimed_username: row.assigned_user_id ? (usernames.get(row.assigned_user_id) || null) : null,
          claimed_at: row.used_at || null,
          access_expires_at: grant?.access_expires_at || null,
        };
      });

      return res.json({ ok: true, tokens, total: Number(count || 0), limit, offset });
    } catch (error) {
      console.error("[PUBLIC TOKEN LIST ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, error: "Token belum dapat dimuat." });
    }
  });

  app.get("/api/public/tokens/:id", portalTokenPublicLimiter, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Token ID tidak valid." });
      const { data: row, error } = await db.from("portal_access_tokens")
        .select("id, token_encrypted, duration_mode, status, redemption_expires_at, published_at, used_at, assigned_user_id")
        .eq("id", req.params.id)
        .not("published_at", "is", null)
        .maybeSingle();
      if (error) throw error;
      if (!row) return res.status(404).json({ ok: false, error: "Token tidak tersedia." });
      if (row.status === "active" && row.redemption_expires_at && new Date(row.redemption_expires_at).getTime() <= Date.now()) {
        await db.from("portal_access_tokens").update({ status: "expired" }).eq("id", row.id).eq("status", "active");
        return res.status(410).json({ ok: false, error: "Token sudah kedaluwarsa." });
      }
      let token = null;
      try { token = decryptPortalToken(row.token_encrypted); } catch { token = null; }
      if (!token) return res.status(500).json({ ok: false, error: "Token tidak dapat disediakan." });
      let username = null;
      let accessExpiresAt = null;
      if (row.assigned_user_id) {
        const [{ data: profile }, { data: grant }] = await Promise.all([
          db.from("member_profiles").select("username").eq("user_id", row.assigned_user_id).maybeSingle(),
          db.from("portal_access_grants").select("access_expires_at").eq("token_id", row.id).order("granted_at", { ascending: true }).limit(1).maybeSingle(),
        ]);
        username = profile?.username || null;
        accessExpiresAt = grant?.access_expires_at || null;
      }
      return res.json({ ok: true, token: { id: row.id, token, status: row.status, duration: row.duration_mode || "legacy", duration_label: getPortalTokenDurationLabel(row.duration_mode), claimed_username: username, claimed_at: row.used_at || null, access_expires_at: accessExpiresAt } });
    } catch (error) {
      console.error("[PUBLIC TOKEN GET ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(500).json({ ok: false, error: "Token tidak dapat diambil." });
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

  app.get('/api/maintenance', async(req,res)=>{try{const {data,error}=await db.rpc('public_get_maintenance');if(error)throw error;let owner=false;const authorization=req.headers.authorization||'';if(authorization.startsWith('Bearer ')){const token=authorization.slice(7).trim();if(token){try{const {data:{user}}=await runtime.supabase.auth.getUser(token);if(user)owner=await runtime.isOwner(user.id);}catch{owner=false;}}}res.setHeader('Cache-Control','no-store, max-age=0');return res.json({ok:true,...data,owner});}catch(e){console.error('[MAINTENANCE ERROR]',e);return res.status(500).json({ok:false,error:'Maintenance status unavailable.'});}});

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

  const healthHandler = async (_req, res) => {
      res.setHeader("Cache-Control", "no-store, max-age=0");
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
  };

  app.get("/api/health", healthHandler);
  app.get("/health", healthHandler);
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
    return res.sendFile("manifest.webmanifest", { root: PUBLIC_DIR });
  });

  app.get("/service-worker.js", (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.sendFile("service-worker.js", { root: PUBLIC_DIR });
  });

  const sendIndex = (_req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.sendFile("index.html", { root: PUBLIC_DIR });
  };

  app.get("/", sendIndex);

  // Canonical SPA view URLs. Every view still uses the single index.html entry point.
  for (const canonicalPath of [
    "/dashboard", "/setting", "/owner", "/app", "/help", "/maintenance", "/reset-password", "/login"
  ]) {
    app.get(canonicalPath, sendIndex);
  }

  const legacyRedirects = {
    "/index.html": "/",
    "/login.html": "/login",
    "/home.html": "/",
    "/dashboard.html": "/dashboard",
    "/setting.html": "/setting",
    "/reset-password.html": "/reset-password",
    "/help.html": "/help",
    "/owner.html": "/owner",
    "/app.html": "/app",
  };

  for (const [legacyPath, canonicalPath] of Object.entries(legacyRedirects)) {
    app.get(legacyPath, (req, res) => {
      const query = String(req.originalUrl || "").split("?", 2)[1] || "";
      return res.redirect(308, query ? `${canonicalPath}?${query}` : canonicalPath);
    });
  }

}
