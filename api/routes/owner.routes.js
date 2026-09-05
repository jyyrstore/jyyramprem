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

export function registerOwnerRoutes(app, deps) {
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
    "/api/owner/claim",
    requireAuth,
    ownerClaimLimiter,
    async (req, res) => {
      try {
        const { data, error } =
          await db.rpc(
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

        const { data, error } = await db.rpc("owner_list_members", {
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
        const { data, error } = await db.rpc("owner_get_member", { p_owner_user_id: req.user.id, p_user_id: req.params.id });
        if (error) throw error;
        return res.json({ ok: true, owner: true, member: data });
      } catch (error) {
        console.error("[OWNER MEMBER GET ERROR]", error);
        const status = memberErrorStatus(error);
        return res.status(status).json({ ok: false, error: status === 500 ? "Gagal membaca member." : error.message });
      }
    }
  );

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
      const { error: deleteMessagesError } = await db.from("owner_messages")
        .delete()
        .or(`sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`);
      if (deleteMessagesError) throw deleteMessagesError;

      const { error: deleteConversationsError } = await db.from("owner_conversations")
        .delete()
        .eq("member_user_id", userId);
      if (deleteConversationsError) throw deleteConversationsError;

      const { error: deleteStatusEventsError } = await db.from("member_status_events")
        .delete()
        .eq("changed_by", userId);
      if (deleteStatusEventsError) throw deleteStatusEventsError;

      const { error: deleteTokenAuditError } = await db.from("portal_access_tokens")
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

  app.post("/api/owner/members/:id/suspend", requireAuth, ownerMemberMutationLimiter, requireOwner, (req, res) => setMemberStatus(req, res, "suspended"));

  app.post("/api/owner/members/:id/ban", requireAuth, ownerMemberMutationLimiter, requireOwner, (req, res) => setMemberStatus(req, res, "banned"));

  app.post("/api/owner/members/:id/unban", requireAuth, ownerMemberMutationLimiter, requireOwner, (req, res) => setMemberStatus(req, res, "active"));

  app.get("/api/owner/broadcasts", requireAuth, ownerBroadcastReadLimiter, requireOwner, async (req, res) => {
    try {
      const limit = parsePositiveInt(req.query.limit, 20, 50);
      const offset = parsePositiveInt(req.query.offset, 0, 1000000);
      if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Parameter pagination tidak valid." });
      const { data, error } = await db.rpc("owner_list_broadcasts", {
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
      const { data, error } = await db.rpc("owner_get_broadcast", { p_owner_user_id: req.user.id, p_broadcast_id: req.params.id });
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
      const { data, error } = await db.rpc("owner_create_broadcast", {
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
      const { data, error } = await db.rpc("owner_update_broadcast", {
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
      const { data, error } = await db.rpc("owner_delete_broadcast", { p_owner_user_id: req.user.id, p_broadcast_id: req.params.id });
      if (error) throw error;
      return res.json({ ok: true, owner: true, deleted: data === true });
    } catch (error) {
      console.error("[OWNER BROADCAST DELETE ERROR]", error);
      const status = broadcastErrorStatus(error);
      return res.status(status).json({ ok: false, error: status === 500 ? "Gagal menghapus broadcast." : error.message });
    }
  });

  app.get("/api/owner/messages", requireAuth, ownerBroadcastReadLimiter, requireOwner, async (req, res) => {
    try {
      const limit = parsePositiveInt(req.query.limit, 20, 50);
      const offset = parsePositiveInt(req.query.offset, 0, 1000000);
      if (limit === null || offset === null) return res.status(400).json({ ok: false, error: "Parameter pagination tidak valid." });
      const { data, error } = await db.rpc("owner_list_conversations", {
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
      const { data, error } = await db.rpc("owner_get_conversation", {
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
      const { data, error } = await db.rpc("owner_create_conversation", {
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
      const { data, error } = await db.rpc("owner_send_message", {
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

  app.get('/api/owner/faq', requireAuth, ownerBroadcastReadLimiter, requireOwner, async (req,res)=>{try{
    const limit=parsePositiveInt(req.query.limit,20,50), offset=parsePositiveInt(req.query.offset,0,1000000);
    if(limit===null||offset===null)return res.status(400).json({ok:false,error:'Pagination tidak valid.'});
    const {data,error}=await db.rpc('owner_list_faq',{p_owner_user_id:req.user.id,p_limit:limit,p_offset:offset}); if(error)throw error;
    return res.json({ok:true,owner:true,...data});
  }catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membaca FAQ.':e.message});}});

  app.post('/api/owner/faq', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{
    const b=req.body||{}; if(typeof b.question!=='string'||typeof b.answer!=='string'||b.question.trim().length<3||b.question.length>500||b.answer.trim().length<1||b.answer.length>10000)return res.status(400).json({ok:false,error:'FAQ tidak valid.'});
    const {data,error}=await db.rpc('owner_create_faq',{p_owner_user_id:req.user.id,p_question:b.question,p_answer:b.answer,p_category:typeof b.category==='string'?b.category:null,p_sort_order:Number.isInteger(b.sort_order)?b.sort_order:0,p_published:b.published!==false}); if(error)throw error;
    return res.status(201).json({ok:true,owner:true,faq:data});
  }catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membuat FAQ.':e.message});}});

  app.patch('/api/owner/faq/:id', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{
    if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'FAQ ID tidak valid.'}); const b=req.body||{};
    const {data,error}=await db.rpc('owner_update_faq',{p_owner_user_id:req.user.id,p_id:req.params.id,p_question:b.question,p_answer:b.answer,p_category:b.category||null,p_sort_order:Number.isInteger(b.sort_order)?b.sort_order:0,p_published:b.published!==false}); if(error)throw error; return res.json({ok:true,owner:true,faq:data});
  }catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal memperbarui FAQ.':e.message});}});

  app.delete('/api/owner/faq/:id', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'FAQ ID tidak valid.'});const {data,error}=await db.rpc('owner_delete_faq',{p_owner_user_id:req.user.id,p_id:req.params.id});if(error)throw error;return res.json({ok:true,owner:true,deleted:data===true});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal menghapus FAQ.':e.message});}});

  app.get('/api/owner/help', requireAuth, ownerBroadcastReadLimiter, requireOwner, async(req,res)=>{try{const limit=parsePositiveInt(req.query.limit,20,50),offset=parsePositiveInt(req.query.offset,0,1000000);if(limit===null||offset===null)return res.status(400).json({ok:false,error:'Pagination tidak valid.'});const {data,error}=await db.rpc('owner_list_help',{p_owner_user_id:req.user.id,p_limit:limit,p_offset:offset});if(error)throw error;return res.json({ok:true,owner:true,...data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membaca Help Center.':e.message});}});

  app.post('/api/owner/help', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{const b=req.body||{};if(typeof b.title!=='string'||typeof b.slug!=='string'||typeof b.content!=='string'||b.title.trim().length<3||b.title.length>200||b.content.trim().length<1||b.content.length>20000)return res.status(400).json({ok:false,error:'Artikel Help Center tidak valid.'});const {data,error}=await db.rpc('owner_create_help',{p_owner_user_id:req.user.id,p_title:b.title,p_slug:b.slug,p_content:b.content,p_category:typeof b.category==='string'?b.category:null,p_sort_order:Number.isInteger(b.sort_order)?b.sort_order:0,p_published:b.published!==false});if(error)throw error;return res.status(201).json({ok:true,owner:true,help:data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membuat artikel.':e.message});}});

  app.patch('/api/owner/help/:id', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'Help ID tidak valid.'});const b=req.body||{};const {data,error}=await db.rpc('owner_update_help',{p_owner_user_id:req.user.id,p_id:req.params.id,p_title:b.title,p_slug:b.slug,p_content:b.content,p_category:b.category||null,p_sort_order:Number.isInteger(b.sort_order)?b.sort_order:0,p_published:b.published!==false});if(error)throw error;return res.json({ok:true,owner:true,help:data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal memperbarui artikel.':e.message});}});

  app.delete('/api/owner/help/:id', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'Help ID tidak valid.'});const {data,error}=await db.rpc('owner_delete_help',{p_owner_user_id:req.user.id,p_id:req.params.id});if(error)throw error;return res.json({ok:true,owner:true,deleted:data===true});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal menghapus artikel.':e.message});}});

  app.get('/api/owner/login-activity', requireAuth, ownerBroadcastReadLimiter, requireOwner, async(req,res)=>{try{const limit=parsePositiveInt(req.query.limit,20,50),offset=parsePositiveInt(req.query.offset,0,1000000);if(limit===null||offset===null)return res.status(400).json({ok:false,error:'Pagination tidak valid.'});const {data,error}=await db.rpc('owner_list_login_activity',{p_owner_user_id:req.user.id,p_limit:limit,p_offset:offset});if(error)throw error;return res.json({ok:true,owner:true,...data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membaca login activity.':e.message});}});

  app.get('/api/owner/maintenance', requireAuth, ownerBroadcastReadLimiter, requireOwner, async(req,res)=>{try{const {data,error}=await db.rpc('owner_get_system_settings',{p_owner_user_id:req.user.id});if(error)throw error;return res.json({ok:true,owner:true,settings:data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal membaca maintenance.':e.message});}});

  app.patch('/api/owner/maintenance', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{const enabled=Boolean(req.body?.enabled),message=typeof req.body?.message==='string'?req.body.message:'';if(message.length>500)return res.status(400).json({ok:false,error:'Pesan maintenance terlalu panjang.'});const {data,error}=await db.rpc('owner_set_maintenance',{p_owner_user_id:req.user.id,p_enabled:enabled,p_message:message});if(error)throw error;return res.json({ok:true,owner:true,settings:data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal mengubah maintenance.':e.message});}});

  app.post('/api/owner/broadcasts/:id/execute', requireAuth, ownerMemberMutationLimiter, requireOwner, async(req,res)=>{try{if(!isUuid(req.params.id))return res.status(400).json({ok:false,error:'Broadcast ID tidak valid.'});const {data,error}=await db.rpc('owner_execute_broadcast',{p_owner_user_id:req.user.id,p_broadcast_id:req.params.id});if(error)throw error;return res.json({ok:true,owner:true,...data});}catch(e){const st=ownerCrudError(e);return res.status(st).json({ok:false,error:st===500?'Gagal menjalankan broadcast.':e.message});}});

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
        const { error } = await db.from("am_api_usage")
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
}
