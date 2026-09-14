import runtime from "../../lib/runtime/app-runtime.js";

const {
  db,
  normalizeUserEmail,
  AUTH_EMAIL_VERIFICATION_TTL_MINUTES,
  AUTH_EMAIL_RESEND_COOLDOWN_SECONDS,
  assertEmailVerificationConfig,
  verificationRequestHash,
  supabaseAuth,
  supabaseOAuth,
  publicUser,
  ensureMemberProfile,
  findPendingEmailVerification,
  sendSignupVerificationEmail,
  assertMaintenanceOff
} = runtime;

export function registerAuthRoutes(app, deps) {
  const {
    authRegisterLimiter,
    authResendLimiter,
    authVerifyLimiter,
    authGoogleLimiter,
    requireAuth,
  } = deps;

  app.get("/api/auth/google", authGoogleLimiter, async (_req, res) => {
    const configuredUrl = String(process.env.APP_URL || "https://www.jyyramprem.my.id").trim();
    let redirectTo;
    try {
      const parsed = new URL(configuredUrl);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Invalid APP_URL");
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/";
      parsed.search = "";
      parsed.hash = "";
      redirectTo = parsed.toString();
    } catch {
      redirectTo = "https://www.jyyramprem.my.id/";
    }

    try {
      const { data, error } = await supabaseOAuth.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error || !data?.url) throw error || new Error("Google OAuth URL tidak tersedia.");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Referrer-Policy", "no-referrer");
      return res.redirect(302, data.url);
    } catch (error) {
      console.error("[AUTH GOOGLE OAUTH ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
      const target = new URL(redirectTo);
      target.searchParams.set("auth_error", "google");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      return res.redirect(302, target.toString());
    }
  });

  app.post("/api/auth/bootstrap", deps.requireAuth, async (req, res) => {
    try {
      const result = await ensureMemberProfile(req.user);
      return res.json({
        ok: true,
        created: result.created,
        profile: result.profile,
        user: publicUser(req.user),
      });
    } catch (error) {
      console.error("[AUTH BOOTSTRAP ERROR]", { code: error?.code || null, message: error?.message || "Unknown error" });
      return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_BOOTSTRAP_FAILED", error: "Profil akun tidak dapat disiapkan." });
    }
  });

  app.delete("/api/auth/account", requireAuth, async (req, res) => {
    try {
      const currentEmail = String(req.user?.email || "").trim().toLowerCase();
      const confirmationEmail = String(req.body?.confirmationEmail || "").trim().toLowerCase();

      if (!currentEmail) {
        return res.status(400).json({
          ok: false,
          code: "ACCOUNT_EMAIL_UNAVAILABLE",
          error: "Email akun tidak tersedia.",
        });
      }

      if (!confirmationEmail || confirmationEmail !== currentEmail) {
        return res.status(400).json({
          ok: false,
          code: "ACCOUNT_DELETE_CONFIRMATION_REQUIRED",
          error: "Konfirmasi email akun tidak cocok.",
        });
      }

      const userId = String(req.user?.id || "").trim();
      if (!userId) {
        return res.status(401).json({
          ok: false,
          code: "AUTH_REQUIRED",
          error: "Session tidak valid.",
        });
      }

      // Never allow the Owner account to be self-deleted.
      const { data: ownerLock, error: ownerLockError } = await db
        .from("owner_lock")
        .select("owner_user_id")
        .eq("id", true)
        .maybeSingle();

      if (ownerLockError) {
        console.error(
          "[AUTH DELETE OWNER CHECK ERROR]",
          ownerLockError?.message || ownerLockError
        );

        return res.status(500).json({
          ok: false,
          code: "OWNER_PROTECTION_CHECK_FAILED",
          error: "Proteksi akun Owner tidak dapat diverifikasi.",
        });
      }

      if (ownerLock?.owner_user_id === userId) {
        return res.status(403).json({
          ok: false,
          code: "OWNER_ACCOUNT_PROTECTED",
          error: "Akun Owner tidak dapat dihapus.",
        });
      }

      const { error } = await supabase.auth.admin.deleteUser(userId, false);

      if (error) {
        console.error("[AUTH DELETE ACCOUNT ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
        return res.status(500).json({
          ok: false,
          code: "ACCOUNT_DELETE_FAILED",
          error: "Akun tidak dapat dihapus saat ini.",
        });
      }

      res.setHeader("Cache-Control", "no-store, max-age=0");

      return res.status(200).json({
        ok: true,
        deleted: true,
      });
    } catch (error) {
      console.error("[AUTH DELETE ACCOUNT EXCEPTION]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
      return res.status(500).json({
        ok: false,
        code: "ACCOUNT_DELETE_FAILED",
        error: "Akun tidak dapat dihapus saat ini.",
      });
    }
  });

  app.post("/api/auth/register", authRegisterLimiter, async (req, res) => {
    try { await assertMaintenanceOff(); } catch (error) { return res.status(Number(error.status) || 503).json({ ok: false, code: error.code || "MAINTENANCE_MODE", maintenance: true, error: error.message }); }
    try {
      const parsed = normalizeUserEmail(req.body?.email);
      if (!parsed.valid) return res.status(400).json({ ok: false, code: "INVALID_EMAIL", error: "Masukkan alamat email yang valid." });
      const email = parsed.value;
      const password = String(req.body?.password || "");
      const rawUsername = String(req.body?.data?.username || "").trim();
      if (!rawUsername) return res.status(400).json({ ok: false, code: "USERNAME_REQUIRED", error: "Username wajib diisi." });
      const normalizedUsername = rawUsername.startsWith("@") ? `@${rawUsername.slice(1).toLowerCase()}` : `@${rawUsername.toLowerCase()}`;
      if (!/^@[a-z0-9](?:[a-z0-9._-]{2,28})$/.test(normalizedUsername)) {
        return res.status(422).json({ ok: false, code: "INVALID_USERNAME", error: "Username harus 3–29 karakter: huruf, angka, titik, underscore, atau strip." });
      }
      const { data: existingUsername, error: usernameLookupError } = await db.from("member_profiles")
        .select("user_id")
        .eq("username", normalizedUsername)
        .maybeSingle();
      if (usernameLookupError) throw usernameLookupError;
      if (existingUsername?.user_id) return res.status(409).json({ ok: false, code: "USERNAME_EXISTS", error: "Username sudah digunakan." });
      if (password.length < 8) return res.status(422).json({ ok: false, code: "WEAK_PASSWORD", error: "Password minimal 8 karakter." });
      assertEmailVerificationConfig();

      const metadata = (req.body?.data && typeof req.body.data === "object") ? { ...req.body.data, username: normalizedUsername, nickname: normalizedUsername } : { username: normalizedUsername, nickname: normalizedUsername };

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
      const signupIdentities = Array.isArray(user?.identities) ? user.identities : null;
      // Supabase may intentionally return an obfuscated user object for an
      // already-registered email. Never create verification state for that
      // ambiguous object; only treat an explicitly empty identities array as
      // an obfuscated existing-user response.
      const signupIdentitiesObfuscated = signupIdentities !== null && signupIdentities.length === 0;
      if (!user?.id || signupIdentitiesObfuscated) {
        const pending = await findPendingEmailVerification(email);
        if (pending) {
          return res.status(409).json({
            ok: false,
            code: "EMAIL_PENDING_VERIFICATION",
            stage: "pending_email",
            email,
            error: "Email sudah digunakan tetapi belum terverifikasi. Masukkan code 6 digit atau kirim ulang code.",
          });
        }
        return res.status(409).json({ ok: false, code: "EMAIL_EXISTS", error: "Email sudah terdaftar. Silakan masuk." });
      }

      const userId = user.id;
      const { error: profileError } = await db.from("member_profiles").upsert({ user_id: userId, username: normalizedUsername }, { onConflict: "user_id" });
      if (profileError) {
        if (profileError.code === "23505") return res.status(409).json({ ok: false, code: "USERNAME_EXISTS", error: "Username sudah digunakan." });
        throw profileError;
      }
      const requestHash = verificationRequestHash(userId);
      await db.from("am_email_verifications").delete().eq("user_id", userId).is("used_at", null);
      const { error: insertError } = await db.from("am_email_verifications").insert({
        user_id: userId,
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
      console.error("[AUTH REGISTER ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
      return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_REGISTER_FAILED", error: error.status ? error.message : "Registrasi gagal. Coba lagi." });
    }
  });

  app.post("/api/auth/resend-verification", authResendLimiter, async (req, res) => {
    try { await assertMaintenanceOff(); } catch (error) { return res.status(Number(error.status) || 503).json({ ok: false, code: error.code || "MAINTENANCE_MODE", maintenance: true, error: error.message }); }
    try {
      const parsed = normalizeUserEmail(req.body?.email);
      if (!parsed.valid) return res.status(400).json({ ok: false, code: "INVALID_EMAIL", error: "Masukkan alamat email yang valid." });
      assertEmailVerificationConfig();
      const email = parsed.value;
      const recent = await findPendingEmailVerification(email);
      if (!recent) return res.status(404).json({ ok: false, code: "USER_NOT_FOUND", error: "Akun belum memiliki code verifikasi aktif. Silakan daftar atau masuk." });
      const retryAt = recent?.created_at ? new Date(new Date(recent.created_at).getTime() + AUTH_EMAIL_RESEND_COOLDOWN_SECONDS * 1000) : null;
      if (retryAt && retryAt.getTime() > Date.now()) {
        const retryAfter = Math.ceil((retryAt.getTime() - Date.now()) / 1000);
        return res.status(429).json({ ok: false, code: "RESEND_COOLDOWN", retryAfter, error: `Tunggu ${retryAfter} detik sebelum mengirim ulang code.` });
      }

      const userId = recent.user_id;
      const requestHash = verificationRequestHash(userId);
      await db.from("am_email_verifications").delete().eq("user_id", userId).is("used_at", null);
      const { error: insertError } = await db.from("am_email_verifications").insert({
        user_id: userId,
        email,
        token_hash: requestHash,
        expires_at: new Date(Date.now() + AUTH_EMAIL_VERIFICATION_TTL_MINUTES * 60000).toISOString(),
      });
      if (insertError) throw insertError;
      try {
        await sendSignupVerificationEmail(email);
      } catch (mailError) {
        await db.from("am_email_verifications").delete().eq("user_id", userId).is("used_at", null);
        throw mailError;
      }
      return res.json({ ok: true, email, resendAvailableAt: new Date(Date.now() + AUTH_EMAIL_RESEND_COOLDOWN_SECONDS * 1000).toISOString() });
    } catch (error) {
      console.error("[AUTH RESEND ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
      return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_RESEND_FAILED", retryAfter: Number(error.retryAfter || 0), error: error.status ? error.message : "Tidak dapat mengirim code verifikasi." });
    }
  });

  app.post("/api/auth/verify-email", authVerifyLimiter, async (req, res) => {
    try { await assertMaintenanceOff(); } catch (error) { return res.status(Number(error.status) || 503).json({ ok: false, code: error.code || "MAINTENANCE_MODE", maintenance: true, error: error.message }); }
    try {
      const parsed = normalizeUserEmail(req.body?.email);
      if (!parsed.valid) return res.status(400).json({ ok: false, code: "INVALID_EMAIL", error: "Email tidak valid." });
      const code = String(req.body?.code || "").replace(/\D/g, "");
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, code: "INVALID_CODE", error: "Masukkan 6 digit code verifikasi." });
      const email = parsed.value;
      const rowBase = await findPendingEmailVerification(email);
      if (!rowBase) {
        const password = String(req.body?.password || "");
        if (password) {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (!error && data?.session) return res.json({ ok: true, stage: "email_verified", ...data });
        }
        return res.status(404).json({ ok: false, code: "USER_NOT_FOUND", error: "Code verifikasi aktif tidak ditemukan." });
      }
      const userId = rowBase.user_id;
      const user = { id: userId, email };
      const { data: row, error: rowError } = await db.from("am_email_verifications").select("id,expires_at,used_at,attempt_count").eq("id", rowBase.id).maybeSingle();
      if (rowError) throw rowError;
      if (!row || row.expires_at <= new Date().toISOString()) return res.status(410).json({ ok: false, code: "CODE_EXPIRED", error: "Code verifikasi sudah kedaluwarsa. Kirim ulang code baru." });

      const { data: otpData, error: otpError } = await supabaseAuth.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (otpError || !otpData?.session) {
        const nextAttempts = Number(row.attempt_count || 0) + 1;
        await db.from("am_email_verifications").update({ attempt_count: nextAttempts }).eq("id", row.id);
        if (nextAttempts >= 5) {
          await db.from("am_email_verifications").delete().eq("id", row.id);
          return res.status(429).json({ ok: false, code: "CODE_ATTEMPTS_EXCEEDED", error: "Terlalu banyak percobaan. Kirim ulang code verifikasi baru." });
        }
        return res.status(401).json({ ok: false, code: "INVALID_CODE", error: otpError?.message || "Code verifikasi salah." });
      }

      const { data: confirmedUser, error: updateError } = await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
      if (updateError) throw updateError;
      const updated = confirmedUser || { user: user };
      await db.from("am_email_verifications").update({ used_at: new Date().toISOString() }).eq("id", row.id);

      // verifyOtp() already returns the authenticated Supabase session. Reuse it
      // directly so registration does not force the user through a second
      // email+password login before the Portal Token gate.
      return res.json({ ok: true, stage: "email_verified", user: publicUser(updated.user), ...otpData });
    } catch (error) {
      console.error("[AUTH VERIFY ERROR]", { code: error?.code || null, status: error?.status || null, message: error?.message || "Unknown error" });
      return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_VERIFY_FAILED", error: error.status ? error.message : "Verifikasi email gagal." });
    }
  });
}
