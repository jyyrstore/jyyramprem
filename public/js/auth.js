const $ = (selector) => document.querySelector(selector);

let mode = "login";

/* =========================================================
   PASSWORD TOGGLE
========================================================= */

const togglePassword = $("#togglePassword");
const passwordInput = $("#password");

const passwordIcon = togglePassword?.querySelector("img");

togglePassword?.addEventListener("click", () => {
  if (!passwordInput || !passwordIcon) return;

  const show = passwordInput.type === "password";

  passwordInput.type = show ? "text" : "password";

  passwordIcon.src = show
    ? "/assets/Icon/tampilkan-sandi.png"
    : "/assets/Icon/tutup-sandi.png";

  passwordIcon.alt = show
    ? "Sembunyikan password"
    : "Tampilkan password";

  togglePassword.setAttribute(
    "aria-label",
    show
      ? "Sembunyikan password"
      : "Lihat password"
  );
});


/* =========================================================
   STATUS
========================================================= */

function status(message, type = "info") {
  // Notifikasi ditampilkan oleh JYYRNotify di bagian atas layar.
  // Jangan render pesan ke authStatus agar tidak muncul kotak status
  // tambahan di dalam form.
  window.JYYRNotify?.show(message, type);
}

let resendCooldownTimer = null;
let registerOtpStep = false;
function startResendCooldown(seconds = 60) {
  const button = $("#resendCode");
  if (!button) return;
  if (resendCooldownTimer) clearInterval(resendCooldownTimer);
  let remaining = Math.max(1, Number(seconds) || 60);
  button.disabled = true;
  const render = () => {
    button.textContent = `Kirim ulang code (${remaining}s)`;
    remaining -= 1;
    if (remaining < 0) {
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
      button.disabled = false;
      button.textContent = "Kirim ulang code";
    }
  };
  render();
  resendCooldownTimer = setInterval(render, 1000);
}


/* =========================================================
   AUTH MODE
========================================================= */

function setMode(next) {
  mode = next;
  registerOtpStep = false;

  const registerMode = mode === "register";

  $("#registerTab")?.classList.toggle("active", registerMode);
  $("#googleSignInBtn")?.classList.toggle("hidden", registerOtpStep);
  $("#googleSignInBtn")?.querySelector(".google-label")?.replaceChildren(
    document.createTextNode(
      registerMode ? "Google" : "Google"
    )
  );

  $("#modeTitle").textContent = registerMode ? "Daftar" : "Masuk";

  $("#modeDescription").textContent = registerMode
    ? "Buat akun baru untuk mengakses portal."
    : "Masuk untuk mengakses portal.";

  $("#emailLabel").textContent = "Email / Gmail";

  const usernameField = $("#usernameField");
  const usernameInput = $("#username");

  // Username remains part of REGISTER and is intentionally hidden only
  // while the page is in LOGIN mode. It must survive the OTP step so the
  // value supplied before verification is still submitted as Auth metadata.
  usernameField?.classList.toggle("hidden", !registerMode);
  usernameInput?.toggleAttribute("required", registerMode);
  usernameInput?.setAttribute("aria-required", registerMode ? "true" : "false");

  const showOtpStep = registerMode && registerOtpStep;

  $("#registerCodeField")?.classList.toggle(
    "hidden",
    !showOtpStep
  );

  $("#resendCode")?.classList.toggle(
    "hidden",
    !showOtpStep
  );

  $("#forgotPassword")?.classList.toggle(
    "hidden",
    registerMode
  );

  // The visible bottom button is the mode switch:
  // LOGIN mode -> DAFTAR, REGISTER mode -> MASUK.
  const submitButton = $("#submitBtn");

  if (submitButton) {
    submitButton.textContent = registerMode
      ? (registerOtpStep ? "VERIFY CODE" : "CREATE ACCOUNT")
      : "LOGIN";
  }

  if (registerMode) {
    const codeInput = $("#code");
    if (codeInput) codeInput.value = "";
  }

  $("#password").autocomplete = registerMode
    ? "new-password"
    : "current-password";
}


/* =========================================================
   MODE BUTTONS
========================================================= */

// Tombol bawah bersifat toggle: DAFTAR -> MASUK -> DAFTAR.
$("#registerTab").onclick = () => {
  setMode(mode === "register" ? "login" : "register");
};

$("#googleSignInBtn")?.addEventListener("click", () => {
  const isRegisterMode = mode === "register";
  if (registerOtpStep || (mode !== "login" && !isRegisterMode)) return;

  const button = $("#googleSignInBtn");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.querySelector(".google-label")?.replaceChildren(
    document.createTextNode(
      isRegisterMode ? "MEMBUKA GOOGLE UNTUK DAFTAR…" : "MEMBUKA GOOGLE…"
    )
  );

  AMAuth.signInWithGoogle();
});


/* =========================================================
   FORGOT PASSWORD
========================================================= */

$("#forgotPassword").onclick = async () => {
  const email = $("#email").value.trim();

  if (!email.includes("@")) {
    status(
      "Masukkan email terdaftar terlebih dahulu.",
      "error"
    );

    return;
  }

  try {
    await AMAuth.resetPassword(
      email,
      `${location.origin}/`
    );

    status(
      "Instruksi reset password dikirim jika email terdaftar.",
      "success"
    );
  } catch (error) {
    status(
      error.message || "Gagal mengirim reset password.",
      "error"
    );
  }
};


/* =========================================================
   PORTAL ACCESS TOKEN GATE
========================================================= */

let portalGateOpen = false;

function setPortalGateStatus(message = "", type = "") {
  const el = $("#portalTokenStatus");
  if (!el) return;
  el.textContent = message;
  el.className = `token-status${type ? ` ${type}` : ""}`;
}

function showPortalTokenGate() {
  const gate = $("#tokenGate");
  if (!gate) return;
  portalGateOpen = true;
  gate.hidden = false;
  gate.setAttribute("aria-hidden", "false");
  setPortalGateStatus("");
  setTimeout(() => $("#portalTokenInput")?.focus(), 0);
}

function closePortalTokenGate() {
  const gate = $("#tokenGate");
  if (!gate) return;
  portalGateOpen = false;
  gate.hidden = true;
  gate.setAttribute("aria-hidden", "true");
  setPortalGateStatus("");
}

async function continueAfterAuth() {
  const session = await AMAuth.getSession();
  if (!session?.access_token) {
    closePortalTokenGate();
    window.JYYRApp?.navigate("login", { replaceUrl: true });
    throw new Error("Session autentikasi tidak tersedia.");
  }

  const bootstrap = await AMAuth.bootstrapAccount().catch((error) => ({
    response: { ok: false, status: 500 },
    data: { error: error?.message || "Profil akun tidak dapat disiapkan." },
  }));
  if (!bootstrap?.response?.ok) {
    const message = bootstrap?.data?.error || "Akun tidak dapat digunakan saat ini.";
    setPortalGateStatus(message, "error");
    throw new Error(message);
  }

  const { response, data } = await AMAuth.getPortalAccess();
  if (response.ok && (data.access === true || data.owner === true)) {
    closePortalTokenGate();
    window.JYYRApp?.navigate("home");
    return true;
  }
  showPortalTokenGate();
  return false;
}

async function verifyPortalTokenFromGate() {
  const input = $("#portalTokenInput");
  const button = $("#verifyPortalTokenBtn");
  const token = String(input?.value || "").replace(/[-\s]/g, "").toUpperCase();
  if (!/^JYYR[A-F0-9]{8}$/.test(token)) {
    setPortalGateStatus("Token harus berformat JYYR + 8 karakter heksadesimal.", "error");
    input?.focus();
    return;
  }
  button.disabled = true;
  setPortalGateStatus("Memverifikasi token…");
  try {
    const { response, data } = await AMAuth.verifyPortalToken(token);
    if (!response.ok || data.valid !== true) throw new Error(data.error || "Token tidak valid.");
    setPortalGateStatus("Token valid. Membuka portal…", "success");
    setTimeout(() => window.JYYRApp?.navigate("home"), 180);
  } catch (error) {
    setPortalGateStatus(error.message || "Token tidak valid.", "error");
  } finally {
    button.disabled = false;
  }
}

async function contactOwnerForPortalTokenFromGate() {
  const button = $("#getPortalTokenBtn");
  button.disabled = true;
  setPortalGateStatus("Menyiapkan kontak Owner…");
  try {
    const { response, data } = await AMAuth.contactOwnerForPortalToken();
    if (!response.ok) throw new Error(data.error || "Gagal membuka kontak Owner.");
    setPortalGateStatus("Membuka WhatsApp Owner…", "success");
    if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
    else throw new Error("WhatsApp Owner belum tersedia.");
  } catch (error) {
    setPortalGateStatus(error.message || "Gagal membuka kontak Owner.", "error");
  } finally {
    button.disabled = false;
  }
}

$("#tokenGateClose")?.addEventListener("click", closePortalTokenGate);
$("#verifyPortalTokenBtn")?.addEventListener("click", verifyPortalTokenFromGate);
$("#getPortalTokenBtn")?.addEventListener("click", contactOwnerForPortalTokenFromGate);
$("#portalTokenInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    verifyPortalTokenFromGate();
  }
});

/* =========================================================
   SUBMIT AUTHENTICATION
========================================================= */

async function submit(event) {
  event.preventDefault();

  const email = $("#email").value.trim();
  const password = $("#password").value;
  const username = $("#username").value.trim();
  const code = $("#code").value.replace(/\D/g, "").slice(0, 6);

  /* -----------------------------------------
     Validation
  ----------------------------------------- */

  if (!email.includes("@")) {
    status(
      "Format email tidak valid.",
      "error"
    );

    return;
  }

  if (password.length < 8) {
    status(
      "Password minimal 8 karakter.",
      "error"
    );

    return;
  }

  if (
    mode === "register" &&
    username.length < 3
  ) {
    status(
      "Username minimal 3 karakter.",
      "error"
    );

    return;
  }

  const submitButton = $("#submitBtn");

  const stopLoading = window.JYYRNotify?.buttonLoading(submitButton, mode === "register" ? "Memproses…" : "Masuk…");

  try {

    /* -----------------------------------------
       REGISTER
    ----------------------------------------- */

    if (mode === "register") {

      /*
       * STEP 1
       * Create account and send verification code.
       */

      if (!code) {
        await AMAuth.signUp(
          email,
          password,
          {
            username,
            nickname: username
          }
        );


        status(
          "Registrasi berhasil dibuat. Masukkan code 6 digit yang dikirim ke email.",
          "success"
        );

        registerOtpStep = true;
        $("#registerCodeField")?.classList.remove("hidden");
        $("#resendCode")?.classList.remove("hidden");
        $("#submitBtn").textContent = "VERIFY CODE";
        $("#code")?.focus();
        startResendCooldown(60);

        return;
      }

      /*
       * STEP 2
       * Verify email OTP.
       */

      await AMAuth.verifyOtp(
        email,
        code
      );

      status("Akun berhasil diverifikasi. Masukkan Token Akses Portal.", "success");
      await continueAfterAuth();

      return;
    }


    /* -----------------------------------------
       LOGIN
    ----------------------------------------- */

    await AMAuth.signIn(
      email,
      password
    );

    status("Login berhasil. Masukkan Token Akses Portal.", "success");
    await continueAfterAuth();

  } catch (error) {

    const message = String(
      error?.message || ""
    );

    const normalized = message.toLowerCase();
    if (error?.code === "EMAIL_PENDING_VERIFICATION") {
      registerOtpStep = true;
      $("#registerCodeField")?.classList.remove("hidden");
      $("#resendCode")?.classList.remove("hidden");
      $("#submitBtn").textContent = "VERIFY CODE";
      $("#code")?.focus();
      status(error.message || "Email belum terverifikasi. Masukkan code 6 digit.", "warning");
    } else if (error?.code === "EMAIL_EXISTS") {
      status(error.message || "Email sudah terdaftar. Silakan masuk.", "error");
    } else if (normalized.includes("email not confirmed")) {
      status(
        "Email belum dikonfirmasi. Gunakan code verifikasi.",
        "warning"
      );
    } else if (normalized.includes("invalid login credentials") || normalized.includes("invalid credentials")) {
      status("Email atau sandi salah.", "error");
    } else if (normalized.includes("email") && normalized.includes("invalid")) {
      status("Format email tidak valid.", "error");
    } else {
      status(message || "Autentikasi gagal.", "error");
    }

  } finally {
    stopLoading?.();
  }
}


/* =========================================================
   AUTH FORM
========================================================= */

$("#authForm").addEventListener(
  "submit",
  submit
);


/* =========================================================
   RESEND VERIFICATION CODE
========================================================= */

$("#resendCode").onclick = async () => {
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const username = $("#username").value.trim();

  if (!email) {
    status(
      "Masukkan email terlebih dahulu.",
      "error"
    );

    return;
  }

  try {
    await AMAuth.resendSignupCode(email);


    status(
      "Code verifikasi baru dikirim.",
      "success"
    );
    startResendCooldown(60);

  } catch (error) {
    status(
      error.message ||
        "Tidak dapat mengirim ulang code.",
      "error"
    );
  }
};


function adoptTokenCenterRegisterContext() {
  const params = new URLSearchParams(window.location.search);
  const username = String(params.get("username") || sessionStorage.getItem("jyyr:login_username") || "").trim();
  const tokenId = String(params.get("token_id") || sessionStorage.getItem("jyyr:selected_token_id") || "").trim();
  if (username && /^@[a-z0-9](?:[a-z0-9._-]{2,28})$/i.test(username)) {
    const input = $("#username");
    if (input) input.value = username.toLowerCase();
    setMode("register");
  }
  if (/^[0-9a-f-]{36}$/i.test(tokenId)) sessionStorage.setItem("jyyr:selected_token_id", tokenId);
  if (username || tokenId) {
    sessionStorage.removeItem("jyyr:login_username");
    history.replaceState({}, document.title, "/");
  }
  return Boolean(username || tokenId);
}

const hasTokenCenterRegisterContext = adoptTokenCenterRegisterContext();

/* =========================================================
   SESSION CHECK
========================================================= */

const oauthError = AMAuth.consumeOAuthErrorFromUrl?.();
if (oauthError) {
  status(oauthError.cancelled ? "Login Google dibatalkan." : "Login Google gagal. Periksa konfigurasi Google lalu coba lagi.", oauthError.cancelled ? "warning" : "error");
}

(async () => {
  const session = await AMAuth.getSession().catch(() => null);
  if (!session?.access_token) return;
  try {
    await continueAfterAuth();
  } catch (error) {
    if (error?.message) status(error.message, "error");
  }
})();


/* =========================================================
   INITIAL MODE
========================================================= */

if (!hasTokenCenterRegisterContext) setMode("login");

/* =========================================================
   LOGIN BRAND — LETTER WAVE + HOME-MATCHED GRADIENT
========================================================= */

const brandWordmark = document.querySelector("#brandWordmark");

if (brandWordmark) {
  const text = "Jyyr Amprem";
  const fragment = document.createDocumentFragment();

  [...text].forEach((char, index) => {
    const span = document.createElement("span");

    span.className =
      char === " "
        ? "brand-char brand-space"
        : "brand-char";

    span.style.setProperty("--i", index);
    span.textContent = char === " " ? "\u00A0" : char;

    fragment.appendChild(span);
  });

  brandWordmark.replaceChildren(fragment);
}

/* =========================================================
   LOGIN BRAND — APPLY THE SAME PER-LETTER GRADIENT AS HOME
========================================================= */

function applyLoginBrandGradient() {
  if (!brandWordmark) return;

  const rect = brandWordmark.getBoundingClientRect();
  const width = rect.width;

  if (!width) return;

  brandWordmark.querySelectorAll(".brand-char:not(.brand-space)")
    .forEach((span) => {
      const charRect = span.getBoundingClientRect();

      const center =
        charRect.left +
        charRect.width / 2 -
        rect.left;

      const position = Math.max(
        0,
        Math.min(100, (center / width) * 100)
      );

      let color;

      if (position < 32) {
        const t = position / 32;

        color = `rgb(
          ${Math.round(17 + (32 - 17) * t)},
          ${Math.round(221 + (185 - 221) * t)},
          255
        )`;
      } else if (position < 60) {
        const t = (position - 32) / 28;

        color = `rgb(
          ${Math.round(32 + (142 - 32) * t)},
          ${Math.round(185 + (107 - 185) * t)},
          255
        )`;
      } else if (position < 86) {
        const t = (position - 60) / 26;

        color = `rgb(
          ${Math.round(142 + (255 - 142) * t)},
          ${Math.round(107 + (79 - 107) * t)},
          ${Math.round(255 + (215 - 255) * t)}
        )`;
      } else {
        const t = (position - 86) / 14;

        color = `rgb(
          ${Math.round(255 + (28 - 255) * t)},
          ${Math.round(79 + (227 - 79) * t)},
          255
        )`;
      }

      span.style.color = color;
      span.style.webkitTextFillColor = color;
    });
}

document.fonts?.ready.then(() => {
  requestAnimationFrame(applyLoginBrandGradient);
});

window.addEventListener("resize", applyLoginBrandGradient);

window.JYYRAuthView = { setMode, showPortalTokenGate, closePortalTokenGate, continueAfterAuth };
