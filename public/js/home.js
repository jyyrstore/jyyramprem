const $ = (s) => document.querySelector(s);

const icon = (n) => window.icon?.(n) || "";

// Keep HTML rendering safe on the Home page. This helper is intentionally
// local because owner.js is not loaded on the member Home view.
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
   ICONS
========================================================= */

[
  ["settingsIcon", "menu"],
  ["settingsMenu", "settings"],
  ["navSetting", "settings"],
  ["userProfileIcon", "user"]
].forEach(([id, name]) => {
  const e = $("#" + id);
  if (e) e.innerHTML = icon(name);
});

[
  ["closeIcon", "close"],
  ["giftIcon", "gift"],
  ["packageIcon", "package"],
  ["shieldIcon", "shield"],
  ["check1", "lock"],
  ["check2", "shield"],
  ["check3", "chart"],
  ["copyIcon", "file"],
  ["resultCloseIcon", "close"],
  ["resultReopenIcon", "file"],
  ["crownIcon", "check"],
  ["starIcon", "arrowRight"],
  ["chartIcon", "chart"],
  ["giftIcon2", "gift"],
  ["packageIcon2", "package"],
  ["receiptIcon", "receipt"],
  ["storeIcon", "store"],
  ["arrowIcon", "arrowRight"],
  ["colorIcon", "category"],
  ["checkIcon", "check"],
  ["shieldIcon2", "shield"],
  ["refreshIcon", "refresh"],
  ["crownIcon2", "crown"],
  ["lockIcon", "lock"],
  ["stepsIcon", "list"],
  ["stepEmailIcon", "mail"],
  ["stepLinkIcon", "link"],
  ["stepVerifyIcon", "check"],
  ["backendShieldIcon", "shield"],
  ["backendServerIcon", "server"],
  ["socialIcon", "users"],
  ["footerLinkIcon", "file"],
  ["guideIcon", "help"],
  ["accessIcon", "arrowRight"],
  ["faqIcon", "help"],
  ["reportIcon", "alert"],
  ["donateIcon", "gift"],
  ["termsIcon", "file"],
  ["privacyIcon", "lock"],
  ["disclaimerIcon", "info"],
  ["dmcaIcon", "shield"],
  ["homeMenu", "home"],
  ["dashboardMenu", "dashboard"],
  ["downloadAppMenu", "download"],
  ["giftMenu", "gift"],
  ["receiptMenu", "receipt"],
  ["helpMenu", "help"],
  ["logoutMenu", "logout"],
  ["navHome", "home"],
  ["navDashboard", "dashboard"]
].forEach(([id, n]) => {
  const e = $("#" + id);
  if (e) e.innerHTML = icon(n);
});


/* =========================================================
   USER EMAIL FLOW
   The browser supplies a user-controlled email. No portal mailbox provider is used by
   the primary activation flow.
========================================================= */

/* =========================================================
   AUTH
========================================================= */

function authHeaders() {
  return AMAuth.getSession().then(
    (session) => {
      if (!session?.access_token) {
        throw new Error(
          "Login diperlukan."
        );
      }

      return {
        Authorization:
          `Bearer ${session.access_token}`,
        Accept:
          "application/json",
        "Content-Type":
          "application/json"
      };
    }
  );
}


/* =========================================================
   QUOTA
========================================================= */

async function loadQuota() {
  try {
    const h =
      await authHeaders();

    const r = await fetch(
      "/api/usage",
      {
        headers: h,
        cache: "no-store"
      }
    );

    if (!r.ok) {
      throw new Error(
        "Quota tidak tersedia"
      );
    }

    const d =
      await r.json();

    const u =
      d.usage || {};

    const used =
      Number(
        u.consumed_count ?? u.request_count ?? 0
      );

    const limit =
      Number(
        d.limit || 5
      );

    const remaining =
      Math.max(
        limit - used,
        0
      );

    const quotaUsed =
      $("#quotaUsed");

    const quotaLimit =
      $("#quotaLimit");

    const quotaRemaining =
      $("#quotaRemaining");

    const quotaProgress =
      $("#quotaProgress");

    const quotaStatus =
      $("#quotaStatus");
    const quotaUsageLabel = $("#quotaUsageLabel");

    if (quotaUsed) {
      quotaUsed.textContent =
        used;
    }

    if (quotaLimit) {
      quotaLimit.textContent =
        limit;
    }

    if (quotaRemaining) {
      quotaRemaining.textContent =
        remaining;
    }

    if (quotaUsageLabel) {
      quotaUsageLabel.textContent = `${used} / ${limit} used`;
    }

    if (quotaProgress) {
      quotaProgress.style.width =
        `${limit
          ? Math.min(
              (used / limit) * 100,
              100
            )
          : 0}%`;
    }

    if (quotaStatus) {
      quotaStatus.textContent =
        remaining
          ? "Active"
          : "Limited";

      quotaStatus.className =
        "badge blue";
    }

  } catch (e) {
    console.error(
      "[QUOTA ERROR]",
      e
    );
  }
}


/* =========================================================
   STATUS HELPER
========================================================= */

function setStatus(
  text,
  type
) {
  const e =
    $("#status");

  if (!e) {
    return;
  }

  e.textContent = text;
  e.className = "status flow-status-sr";
  window.JYYRNotify?.show(text, type);
}


/* =========================================================
   USER EMAIL -> SEND -> VERIFY -> APPLY PREMIUM
   Generate / Activate flow contract preserved; presentation is modal-only.
========================================================= */

function setFlowBadge(text, type = "blue") {
  const badge = $("#flowBadge");
  if (!badge) return;
  badge.textContent = text;
  badge.className = `badge ${type}`;
}

function setResultLines(lines) {
  const resultText = $("#resultText");
  if (!resultText) return;
  resultText.innerHTML = lines.map(({ label, value }) => `
    <div class="result-line"><span>${escapeHtml(label)}</span><code>${escapeHtml(value)}</code></div>
  `).join("");
}

function setVerificationModal(open) {
  const result = $("#result");
  const reopen = $("#reopenVerificationBtn");
  if (!result) return;

  result.classList.toggle("hidden", !open);
  result.setAttribute("aria-hidden", open ? "false" : "true");
  reopen?.classList.toggle("hidden", !window.__lastGeneratedAccountId || open);
  document.body.classList.toggle("verification-modal-open", open);
}

function resetActivationUi() {
  $("#magicLinkStep")?.classList.add("hidden");
  $("#activationStep")?.classList.add("hidden");
  $("#rawMagicLinkInput") && ($("#rawMagicLinkInput").value = "");
  setVerificationModal(false);
  const deliveryNote = $("#deliveryStatusNote");
  if (deliveryNote) deliveryNote.textContent = "Provider menerima permintaan, tetapi portal belum dapat mengonfirmasi email benar-benar masuk. Ambil link terbaru dari inbox/spam.";
}

let magicLinkPollTimer = null;
let energyTimer = null;

function setEnergyProgress(percent, label = "POWERING UP") {
  const wrap = $("#generateEnergy");
  const bar = $("#energyProgress");
  const value = $("#energyPercent");
  const text = $("#energyLabel");
  const icon = $("#energyIcon");
  if (!wrap || !bar || !value || !text) return;
  if (icon && !icon.innerHTML && window.JYYRNotify?.iconPath) {
    icon.innerHTML = `<img src="${window.JYYRNotify.iconPath("loading")}" alt="" aria-hidden="true" draggable="false">`;
  }
  wrap.classList.remove("hidden");
  wrap.classList.add("is-active");
  const next = Math.max(0, Math.min(Number(percent) || 0, 100));
  bar.style.width = `${next}%`;
  value.textContent = `${Math.round(next)}%`;
  text.textContent = label;
}

function startEnergyProgress() {
  if (energyTimer) clearInterval(energyTimer);
  let current = 0;
  setEnergyProgress(4, "POWERING UP");
  const stages = [
    [18, "CHECKING EMAIL"],
    [34, "CONTACTING PROVIDER"],
    [51, "WAITING FOR DELIVERY"],
    [67, "SYNCING DELIVERY"],
    [82, "PREPARING VERIFICATION"]
  ];
  let index = 0;
  energyTimer = setInterval(() => {
    if (index < stages.length) {
      const [next, label] = stages[index++];
      current = next;
      setEnergyProgress(current, label);
      return;
    }
    current = Math.min(current + 2, 94);
    setEnergyProgress(current, "WAITING FOR RESPONSE");
  }, 280);
}

function stopEnergyProgress(success = true) {
  if (energyTimer) {
    clearInterval(energyTimer);
    energyTimer = null;
  }
  setEnergyProgress(100, success ? "COMPLETE" : "STOPPED");
  window.setTimeout(() => {
    const wrap = $("#generateEnergy");
    wrap?.classList.add("hidden");
    wrap?.classList.remove("is-active");
    const bar = $("#energyProgress");
    const value = $("#energyPercent");
    const text = $("#energyLabel");
    if (bar) bar.style.width = "0%";
    if (value) value.textContent = "0%";
    if (text) text.textContent = "POWERING UP";
  }, 240);
}


async function verifyAndApplyMagicLink(accountId, rawLink, { automatic = false } = {}) {
  if (!accountId || !rawLink) throw new Error("Magic link belum tersedia.");

  const verifyBtn = $("#verifyBtn");
  const stopVerifyLoading = window.JYYRNotify?.buttonLoading(verifyBtn, automatic ? "Memverifikasi & Aktivasi…" : "Memverifikasi…");

  try {
    const h = await authHeaders();
    const verifyResponse = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/verify-email`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ rawLink }),
    });
    const verifyData = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok || !verifyData.ok || verifyData.verified !== true) {
      throw new Error(verifyData.error || verifyData.message || "Magic link belum terverifikasi.");
    }

    setFlowBadge("Terverifikasi", "green");
    const title = $("#flowTitle");
    if (title) title.textContent = automatic ? "Mengaktifkan Premium" : "Verifikasi berhasil";
    const status = $("#verificationStatus");
    if (status) status.textContent = verifyData.message || "Magic link terverifikasi.";
    $("#magicLinkStep")?.classList.add("hidden");
    $("#activationStep")?.classList.remove("hidden");

    // Verification auto-runs apply-premium. Keep the manual button disabled
    // until that request completes so two provider calls cannot race.
    const applyBtn = $("#applyPremiumBtn");
    const stopApplyLoading = window.JYYRNotify?.buttonLoading(applyBtn, "Mengaktifkan Premium…");

    const applyResponse = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/apply-premium`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({}),
    });
    const applyData = await applyResponse.json().catch(() => ({}));
    if (!applyResponse.ok || !applyData.ok || applyData.premiumApplied !== true) {
      // Verification succeeded; do not hide that state when Premium activation needs a retry.
      setFlowBadge("Terverifikasi", "green");
      setStatus(applyData.error || applyData.message || "Verifikasi berhasil, tetapi aktivasi Premium belum berhasil. Coba Aktivasi lagi.", "error");
      stopApplyLoading?.();
      const retryApplyBtn = $("#applyPremiumBtn");
      if (retryApplyBtn) retryApplyBtn.disabled = false;
      return { verified: true, premiumApplied: false, applyData };
    }

    const expiry = Number(applyData?.premium?.expiryTimeMillis);
    const expiryText = Number.isFinite(expiry) && expiry > 0
      ? new Date(expiry).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
      : "Tidak tersedia";

    setFlowBadge("Premium Aktif", "green");
    if (title) title.textContent = "AMPREM BERHASIL";
    setResultLines([
      { label: "Status", value: "AMPREM BERHASIL" },
      { label: "Email", value: window.__lastGeneratedEmail || $("#email")?.value || "" },
      { label: "Premium", value: "Premium Aktif" },
      { label: "Aktivasi", value: "Berhasil" },
      { label: "Berlaku sampai", value: expiryText },
    ]);
    $("#activationStep")?.classList.add("hidden");
    setStatus("Amprem berhasil diaktifkan.", "success");
    stopApplyLoading?.();
    const completedApplyBtn = $("#applyPremiumBtn");
    if (completedApplyBtn) {
      completedApplyBtn.disabled = true;
      completedApplyBtn.innerHTML = `${window.JYYRNotify?.iconPath ? `<img class="asset-ui-icon" src="${window.JYYRNotify.iconPath("success")}" alt="" aria-hidden="true" draggable="false">` : ""}<span>Premium Aktif</span>`;
    }
    await loadQuota();
    return { verified: true, premiumApplied: true, applyData };
  } finally {
    stopVerifyLoading?.();
  }
}

async function pollMagicLinkDelivery(accountIdentifier) {
  if (magicLinkPollTimer) clearTimeout(magicLinkPollTimer);
  const started = Date.now();
  const maxWait = 5 * 60 * 1000;
  const run = async () => {
    if (!accountIdentifier || Date.now() - started > maxWait) return;
    try {
      const h = await authHeaders();
      const r = await fetch(`/api/accounts/${encodeURIComponent(accountIdentifier)}/magiclink-status`, { headers: h, cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        const note = $("#deliveryStatusNote");
        if (d.deliveryConfirmed) {
          setFlowBadge("Delivery Confirmed", "green");
          if (note) note.textContent = "Provider sudah mengonfirmasi delivery. Gunakan link terbaru dari email.";
          setStatus("Email delivery terkonfirmasi. Buka inbox dan tempel magic link terbaru.", "success");
          return;
        }
        if (d.deliveryStatus === "delivery_failed") {
          setFlowBadge("Delivery Failed", "red");
          if (note) note.textContent = d.lastError || "Provider melaporkan delivery gagal. Gunakan Kirim Ulang Magic Link.";
          return;
        }
      }
    } catch {}
    magicLinkPollTimer = setTimeout(run, 5000);
  };
  await run();
}

$("#generateBtn")?.addEventListener("click", async () => {
  const btn = $("#generateBtn");
  const emailInput = $("#email");
  const email = emailInput?.value.trim() || "";

  if (!email) {
    setStatus("Email wajib diisi.", "error");
    emailInput?.focus();
    return;
  }

  if (!emailInput?.checkValidity()) {
    setStatus("Masukkan alamat email yang valid dan bisa kamu akses.", "error");
    emailInput?.focus();
    return;
  }

  const stopGenerateLoading = window.JYYRNotify?.buttonLoading(btn, "Mengirim Magic Link…");
  startEnergyProgress();
  resetActivationUi();
  $("#result")?.classList.add("hidden");
  setStatus("Mengirim magic link ke email kamu…", "info");

  try {
    const h = await authHeaders();
    const idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    h["Idempotency-Key"] = idempotencyKey;

    const r = await fetch("/api/generate", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ email }),
    });

    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || "Gagal mengirim magic link.");

    window.__lastGeneratedAccountId = d.accountId || null;
    window.__lastGeneratedEmail = d.email || email;

    setFlowBadge("Provider Accepted", "blue");
    const title = $("#flowTitle");
    if (title) title.textContent = "Cek inbox kamu";

    setResultLines([
      { label: "Email", value: d.email || email },
      { label: "Status", value: d.deliveryStatus === "delivery_confirmed" ? "Delivery terkonfirmasi" : "Provider menerima request" },
      { label: "Delivery", value: d.deliveryConfirmed ? "Terkonfirmasi" : "Belum terkonfirmasi" },
      { label: "Tujuan", value: d.linkDeliveredTo || d.email || email },
      ...(d.codeOrder ? [{ label: "Provider Order", value: d.codeOrder }] : []),
    ]);

    setVerificationModal(true);

    $("#magicLinkStep")?.classList.remove("hidden");
    const deliveryNote = $("#deliveryStatusNote");
    if (deliveryNote) deliveryNote.textContent = "Provider menerima request. Buka mailbox yang kamu miliki aksesnya, salin magic link terbaru, lalu tempel di sini.";
    setStatus("Magic link dikirim ke mailbox. Buka inbox, salin link terbaru, lalu tempel di sini untuk Verifikasi & Aktivasi.", "info");
    pollMagicLinkDelivery(window.__lastGeneratedAccountId);
    stopEnergyProgress(true);
    await loadQuota();
  } catch (error) {
    stopEnergyProgress(false);
    setStatus(error?.message || "Permintaan magic link gagal.", "error");
  } finally {
    stopGenerateLoading?.();
    if ($("#result")?.classList.contains("hidden")) stopEnergyProgress(false);
  }
});

$("#closeVerificationBtn")?.addEventListener("click", () => {
  setVerificationModal(false);
});

$("#reopenVerificationBtn")?.addEventListener("click", () => {
  setVerificationModal(true);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#result")?.classList.contains("hidden")) {
    setVerificationModal(false);
  }
});

document.addEventListener("click", async (event) => {
  const resendBtn = event.target?.closest?.("#resendMagicLinkBtn");
  if (resendBtn) {
    const accountId = window.__lastGeneratedAccountId;
    if (!accountId) { setStatus("Account belum siap untuk dikirimi ulang.", "error"); return; }
    const stopResendLoading = window.JYYRNotify?.buttonLoading(resendBtn, "Mengirim ulang…");
    try {
      const h = await authHeaders();
      const r = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/send-magiclink`, { method: "POST", headers: h, body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || d.message || "Gagal mengirim ulang magic link.");
      setFlowBadge("Provider Accepted", "blue");
      setStatus("Permintaan baru diterima provider. Gunakan hanya link paling baru dari Inbox/Spam.", "info");
      const note = $("#deliveryStatusNote");
      if (note) note.textContent = "Permintaan baru berhasil dibuat. Tunggu email terbaru; jangan gunakan link dari request sebelumnya.";
      setResultLines([
        { label: "Email", value: d.email || window.__lastGeneratedEmail || "" },
        { label: "Status", value: "Provider menerima request baru" },
        { label: "Delivery", value: "Belum terkonfirmasi" },
        ...(d.codeOrder ? [{ label: "Provider Order", value: d.codeOrder }] : []),
      ]);
      $("#rawMagicLinkInput") && ($("#rawMagicLinkInput").value = "");
      await loadQuota();
    } catch (error) {
      setStatus(error?.message || "Gagal mengirim ulang magic link.", "error");
    } finally {
      stopResendLoading?.();
    }
    return;
  }

  const verifyBtn = event.target?.closest?.("#verifyBtn");
  if (verifyBtn) {
    const accountId = window.__lastGeneratedAccountId;
    const rawLink = $("#rawMagicLinkInput")?.value.trim() || "";
    if (!accountId || !rawLink) {
      setStatus("Tempel magic link terbaru terlebih dahulu.", "error");
      return;
    }

    try {
      await verifyAndApplyMagicLink(accountId, rawLink);
    } catch (error) {
      setStatus(error?.message || "Gagal memverifikasi magic link.", "error");
    }
    return;
  }

  const applyBtn = event.target?.closest?.("#applyPremiumBtn");
  if (!applyBtn) return;

  const accountId = window.__lastGeneratedAccountId;
  if (!accountId) {
    setStatus("Account belum siap untuk diaktifkan.", "error");
    return;
  }

  const stopManualApplyLoading = window.JYYRNotify?.buttonLoading(applyBtn, "Mengaktifkan Premium…");

  try {
    const h = await authHeaders();
    const r = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/apply-premium`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({}),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok || d.premiumApplied !== true) throw new Error(d.error || d.message || "Aktivasi Premium belum berhasil.");

    const expiry = Number(d?.premium?.expiryTimeMillis);
    const expiryText = Number.isFinite(expiry) && expiry > 0
      ? new Date(expiry).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
      : "Tidak tersedia";

    setFlowBadge("Premium Aktif", "green");
    const title = $("#flowTitle");
    if (title) title.textContent = "AMPREM BERHASIL";

    setResultLines([
      { label: "Status", value: "AMPREM BERHASIL" },
      { label: "Email", value: window.__lastGeneratedEmail || $("#email")?.value || "" },
      { label: "Premium", value: "Premium Aktif" },
      { label: "Aktivasi", value: "Berhasil" },
      { label: "Berlaku sampai", value: expiryText },
    ]);

    $("#activationStep")?.classList.add("hidden");
    setStatus("Amprem berhasil diaktifkan.", "success");
    stopManualApplyLoading?.();
    applyBtn.disabled = true;
    applyBtn.innerHTML = `${window.JYYRNotify?.iconPath ? `<img class="asset-ui-icon" src="${window.JYYRNotify.iconPath("success")}" alt="" aria-hidden="true" draggable="false">` : ""}<span>Premium Aktif</span>`;
    await loadQuota();
  } catch (error) {
    setStatus(error?.message || "Gagal mengaktifkan Premium.", "error");
    stopManualApplyLoading?.();
  }
});

/* =========================================================
   OWNER DASHBOARD NAVIGATION
   The Owner action is now a fixed floating navigation button.
========================================================= */
$("#ownerDashboardNav")?.addEventListener("click", () => {
  window.JYYRApp?.navigate("owner");
});


/* =========================================================
   INITIAL LOAD
========================================================= */

(async () => {
  const session = await AMAuth.getSession().catch(() => null);
  if (!session?.access_token) { window.JYYRApp?.navigate("login"); return; }
  try {
    const { response, data } = await AMAuth.getPortalAccess();
    const ownerNav = document.getElementById("ownerDashboardNavWrap");
    if (ownerNav) ownerNav.hidden = data.owner !== true;
    if (!response.ok || (data.access !== true && data.owner !== true)) {
      await AMAuth.signOut().catch(() => {});
      window.JYYRApp?.navigate("login", { tokenRequired: true });
      return;
    }
    loadQuota();
  } catch {
    const ownerNav = document.getElementById("ownerDashboardNavWrap");
    if (ownerNav) ownerNav.hidden = true;
    await AMAuth.signOut().catch(() => {});
    window.JYYRApp?.navigate("login", { tokenRequired: true });
  }
})();

/* =========================================================
   HERO NICKNAME — LETTER WAVE + GRADIENT
========================================================= */

const heroNickname = document.querySelector("#heroNickname");

if (heroNickname) {
  const text = "Jyyr Amprem";

  const fragment = document.createDocumentFragment();

  [...text].forEach((char, index) => {
    const span = document.createElement("span");

    span.className =
      char === " "
        ? "hero-char space"
        : "hero-char";

    span.style.setProperty("--i", index);

    /*
     * Simpan posisi huruf.
     * CSS tetap menangani animasinya.
     */
    if (char === " ") {
      span.innerHTML = "&nbsp;";
    } else {
      span.textContent = char;
    }

    fragment.appendChild(span);
  });

  heroNickname.replaceChildren(fragment);
}

/* =========================================================
   HERO NICKNAME — APPLY GRADIENT PER LETTER
========================================================= */

function applyHeroNicknameGradient() {
  if (!heroNickname) return;

  const rect = heroNickname.getBoundingClientRect();
  const width = rect.width;

  if (!width) return;

  heroNickname.querySelectorAll(".hero-char:not(.space)")
    .forEach((span) => {
      const charRect = span.getBoundingClientRect();

      const center =
        charRect.left +
        charRect.width / 2 -
        rect.left;

      const position =
        Math.max(
          0,
          Math.min(
            100,
            (center / width) * 100
          )
        );

      let color;

      if (position < 32) {
        const t = position / 32;

        color = `rgb(
          ${Math.round(17 + (32 - 17) * t)},
          ${Math.round(221 + (185 - 221) * t)},
          ${Math.round(255 + (255 - 255) * t)}
        )`;
      } else if (position < 60) {
        const t = (position - 32) / 28;

        color = `rgb(
          ${Math.round(32 + (142 - 32) * t)},
          ${Math.round(185 + (107 - 185) * t)},
          ${Math.round(255 + (255 - 255) * t)}
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
          ${Math.round(215 + (255 - 215) * t)}
        )`;
      }

      span.style.color = color;
      span.style.webkitTextFillColor = color;
    });
}


/* Jalankan setelah font selesai dimuat */
document.fonts?.ready.then(() => {
  requestAnimationFrame(applyHeroNicknameGradient);
});


/* Recalculate ketika ukuran layar berubah */
window.addEventListener(
  "resize",
  applyHeroNicknameGradient
);