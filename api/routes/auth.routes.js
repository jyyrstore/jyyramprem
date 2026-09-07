import runtime from "../../lib/runtime/app-runtime.js";

const {
  db,
  normalizeUserEmail,
  AUTH_EMAIL_VERIFICATION_TTL_MINUTES,
  AUTH_EMAIL_RESEND_COOLDOWN_SECONDS,
  supabase,
  assertEmailVerificationConfig,
  verificationRequestHash,
  supabaseAuth,
  publicUser,
  findPendingEmailVerification,
  sendSignupVerificationEmail
} = runtime;

export function registerAuthRoutes(app, deps) {
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

  app.post("/api/auth/register", authRegisterLimiter, async (req, res) => {
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
      console.error("[AUTH REGISTER ERROR]", error);
      return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_REGISTER_FAILED", error: error.status ? error.message : "Registrasi gagal. Coba lagi." });
    }
  });

  app.post("/api/auth/resend-verification", authResendLimiter, async (req, res) => {
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
      console.error("[AUTH RESEND ERROR]", error);
      return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_RESEND_FAILED", retryAfter: Number(error.retryAfter || 0), error: error.status ? error.message : "Tidak dapat mengirim code verifikasi." });
    }
  });

  app.post("/api/auth/verify-email", authVerifyLimiter, async (req, res) => {
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
      console.error("[AUTH VERIFY ERROR]", error);
      return res.status(Number(error.status) || 500).json({ ok: false, code: error.code || "AUTH_VERIFY_FAILED", error: error.status ? error.message : "Verifikasi email gagal." });
    }
  });
}
