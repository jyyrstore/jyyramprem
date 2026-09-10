
/* JYYR_TOKEN_UI_HELPER */
function __jyyrHideGeneratedTokenTitle() {
  const el = document.getElementById("generatedPortalTokenTitle");
  if (el) {
    el.hidden = true;
    el.style.display = "none";
  }
}

async function loadPortalTokenStatus(session) {
  const response = await ownerRequest("/api/owner/token/status", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Status token gagal dimuat.");
  const token = data?.token || { status: "none" };
  const statusEl = document.getElementById("ownerTokenStatus");
  const revoke = document.getElementById("revokePortalToken");
  state.activePortalTokenId = token.status === "active" ? token.id : null;
  if (statusEl) {
    const availableCount = Number(data?.available_count ?? data?.availableCount) || 0;
    const redemption = token.redemption_expires_at ? broadcastDate(token.redemption_expires_at) : "—";
    statusEl.textContent = token.status === "active"
      ? `${availableCount} token available · redemption sampai ${redemption}.`
      : availableCount ? `${availableCount} token available.` : "Tidak ada token available.";
    statusEl.className = `status ${token.status === "active" ? "success" : "info"}`;
    statusEl.hidden = true;
  }
  // The top revoke control always represents the newest active token.
  // Individual active tokens can also be revoked from Token History.
  if (revoke) {
    revoke.disabled = token.status !== "active" || !token.id;
    revoke.hidden = false;
  }

  // Jangan tampilkan toast saat initial load. Notifikasi hanya boleh muncul
  // sebagai hasil aksi user (Generate/Revoke), bukan karena halaman dibuka.
  if (token.status === "active") state.tokenStatusNotified = false;
}

async function loadPortalTokenHistory(session) {
  const query = new URLSearchParams({ limit: String(state.tokenHistoryLimit), offset: String(state.tokenHistoryPage * state.tokenHistoryLimit) });
  const response = await ownerRequest(`/api/owner/token/history?${query.toString()}`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "History token gagal dimuat.");
  const list = document.getElementById("portalTokenHistory");
  if (!list) return;
  state.tokenHistoryTotal = Number(data.total) || 0;
  const pageCount = Math.max(1, Math.ceil(state.tokenHistoryTotal / state.tokenHistoryLimit));
  state.tokenHistoryPage = Math.min(state.tokenHistoryPage, pageCount - 1);
  const totalEl = document.getElementById("tokenHistoryTotal");
  if (totalEl) totalEl.textContent = `Total Token : ${state.tokenHistoryTotal}`;
  const rows = Array.isArray(data.tokens) ? data.tokens : [];
  const labels = { active: "AVAILABLE", used: "ASSIGNED", expired: "EXPIRED", revoked: "REVOKED" };
  const cls = { active: "green", used: "red", expired: "yellow", revoked: "red" };
  if (!rows.length) {
    list.innerHTML = `<div class="status info">Belum ada history token.</div>`;
  } else {
    const body = rows.map((t, index) => {
      // The just-generated token is also available in the current Owner session.
      // Prefer the server-revealed value, then the exact generated token ID;
      // finally use the newest row as a defensive fallback when an older RPC
      // response omitted its id.
      const rememberedToken = findRememberedPortalToken(session, t);
      const serverToken = /^JYYR[A-F0-9]{8}$/.test(String(t.token || "").trim().toUpperCase())
        ? String(t.token).trim().toUpperCase()
        : null;
      const generatedToken = t.id && t.id === state.generatedPortalTokenId && /^JYYR[A-F0-9]{8}$/.test(String(state.generatedPortalToken || "").trim().toUpperCase())
        ? String(state.generatedPortalToken).trim().toUpperCase()
        : null;
      const newestToken = index === 0 && t.status === "active" && /^JYYR[A-F0-9]{8}$/.test(String(state.generatedPortalToken || "").trim().toUpperCase())
        ? String(state.generatedPortalToken).trim().toUpperCase()
        : null;
      // Always prefer a known full 12-character token. A masked preview is
      // only a last-resort display for legacy rows that cannot be recovered.
      const tokenValue = rememberedToken || serverToken || generatedToken || newestToken || null;
      const token = escapeHtml(tokenValue || t.preview || "—");
      if (tokenValue && t.id) rememberPortalTokenOnDevice(session, t.id, tokenValue, t.redemption_expires_at);
      const statusLabel = escapeHtml(labels[t.status] || t.status || "UNKNOWN");
      const statusClass = cls[t.status] || "blue";
      const created = escapeHtml(broadcastDate(t.created_at));
      const durationLabel = escapeHtml(t.duration_label || (t.duration_mode === "permanent" ? "Permanent" : "Legacy"));
      const redemptionExpiry = t.redemption_expires_at
        ? new Date(t.redemption_expires_at)
        : null;
      const redemptionText = Number.isNaN(redemptionExpiry?.getTime?.()) || !redemptionExpiry
        ? "—"
        : escapeHtml(broadcastDate(redemptionExpiry.toISOString()));
      const accessExpiry = t.access_expires_at
        ? new Date(t.access_expires_at)
        : null;
      const accessText = accessExpiry && !Number.isNaN(accessExpiry.getTime())
        ? escapeHtml(broadcastDate(accessExpiry.toISOString()))
        : (t.duration_mode === "permanent" && t.assigned_user_id ? "PERMANENT" : "—");
      const used = t.used_at ? escapeHtml(broadcastDate(t.used_at)) : "—";
      let usageText = "Belum Digunakan";
      if (t.status === "used") {
        usageText = t.used_email ? `User : ${t.used_email}` : (t.assigned_user_id ? "Sudah digunakan" : "Sudah digunakan");
      } else if (t.status === "expired") {
        usageText = "Token Expired";
      } else if (t.status === "revoked") {
        usageText = "Token Revoke";
      }
      const usedBy = `<small class="token-history-usedby">${escapeHtml(usageText)}</small>`;
      const canRevoke = t.status === "active" && isPortalTokenId(t.id);
      const isPublished = Boolean(t.published_at);
      const publishButton = t.status === "active" && isPortalTokenId(t.id)
        ? (isPublished
          ? `<button class="btn token-history-unpublish" type="button" data-unpublish-token-id="${escapeHtml(t.id)}">Hentikan</button>`
          : `<button class="btn primary token-history-publish" type="button" data-publish-token-id="${escapeHtml(t.id)}">Sebarkan</button>`)
        : "";
      const action = canRevoke
        ? `${publishButton}<button class="btn danger token-history-revoke" type="button" data-revoke-token-id="${escapeHtml(t.id)}" data-revoke-token="${escapeHtml(tokenValue || t.preview || "token aktif")}">Cabut</button>`
        : publishButton || "—";
      const timeline = t.status === "active"
        ? `<small>Redemption sampai : ${redemptionText}</small>`
        : t.status === "used"
          ? `<small>Access sampai : ${accessText}</small>`
          : `<small>Redemption sampai : ${redemptionText}</small>`;
      return `<tr data-token-id="${escapeHtml(t.id || "")}"><td><div class="token-history-token">${token}</div>${usedBy}</td><td><span class="badge ${statusClass}">${statusLabel}</span></td><td><strong>${created}</strong><small>Lifetime akses : ${durationLabel}</small>${timeline}</td><td><strong>${used}</strong></td><td class="token-history-action">${action}</td></tr>`;
    }).join("");
    list.innerHTML = `<div class="table-wrap token-history-table-wrap"><table class="table token-history-table"><thead><tr><th>Token</th><th>Status</th><th>Waktu</th><th>Redeem</th><th>Aksi</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  renderPaginationControls("tokenHistoryControls", state.tokenHistoryPage, pageCount, async (target) => {
    state.tokenHistoryPage = target;
    await loadPortalTokenHistory(state.session);
  });
}

async function loadPortalTokenDistributionStatus(session) {
  const response = await ownerRequest("/api/owner/token/distribution-status", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Quota distribusi gagal dimuat.");
  const el = document.getElementById("portalTokenDistributionStatus");
  if (el) {
    el.textContent = `${Number(data.publishedToday || 0)} / ${Number(data.limit || 5)} distribusi hari ini · Sisa ${Number(data.remaining || 0)}`;
    el.className = `status ${Number(data.remaining || 0) > 0 ? "success" : "error"}`;
  }
  const inventory = document.getElementById("portalTokenInventoryCount");
  if (inventory) inventory.textContent = `Belum disebar ke JYY'R Token : ${Number(data.unpublishedInventory || 0)} · token tetap bisa dipakai`;
  return data;
}

function readCanonicalOwnerToken(data) {
  const candidates = [
    data?.token,
    data?.latest?.token,
    Array.isArray(data?.tokens) ? data.tokens[0]?.token : null,
    Array.isArray(data?.tokens) ? data.tokens[data.tokens.length - 1]?.token : null,
  ];
  for (const value of candidates) {
    const token = String(value || "").trim().toUpperCase();
    if (/^JYYR[A-F0-9]{8}$/.test(token) && token.length === 12) return token;
  }
  return null;
}

async function generatePortalToken(session) {
  const durationMode = state.selectedPortalTokenDuration || "permanent";
  const quantity = Math.max(1, Math.min(1000, Number(document.getElementById("portalTokenGenerateQuantity")?.value || 1)));
  const response = await ownerRequest("/api/owner/token/generate-batch", session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duration_mode: durationMode, quantity }),
  });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membuat token.");
  let generatedToken = readCanonicalOwnerToken(data);
  let resolvedData = data;

  // Recovery path for a local server process that created the DB row but did not
  // Legacy diagnostic wording: Deploy backend terbaru JYYRXXXXXXXX when the running process is stale.
  // expose the plaintext token in the batch response. The server resolves the
  // newest token from its in-memory vault or token_encrypted column.
  if (!generatedToken) {
    try {
      const latestResponse = await ownerRequest("/api/owner/token/latest", session);
      const latestData = await parseJson(latestResponse);
      if (latestResponse.ok) {
        const latestToken = readCanonicalOwnerToken(latestData);
        if (latestToken) {
          generatedToken = latestToken;
          resolvedData = { ...data, ...latestData, token: latestToken };
        }
      }
    } catch (recoveryError) {
      console.warn("[OWNER TOKEN LATEST RECOVERY FAILED]", recoveryError);
    }
  }

  if (!generatedToken) {
    console.error("[OWNER TOKEN CONTRACT MISMATCH]", {
      responseStatus: response.status,
      serverBuild: response.headers.get("X-JYYR-Token-Server-Build") || data?.serverBuild || null,
      headerContract: response.headers.get("X-JYYR-Token-Contract") || null,
      ok: data?.ok,
      tokenFormat: data?.tokenFormat || null,
      tokenLength: data?.tokenLength || null,
      hasToken: Boolean(data?.token),
      hasPreview: Boolean(data?.tokenPreview || data?.preview),
    });
    throw new Error("Server mengembalikan token yang bukan format canonical 12 karakter. Token sebenarnya sudah dibuat, tetapi plaintext JYYRXXXXXXXX tidak sampai ke frontend; pastikan proses server lokal menjalankan source token-contract-v3.");
  }
  const dataForUi = resolvedData;
  dataForUi.token = generatedToken;
  const out = document.getElementById("generatedPortalToken");
  state.generatedPortalToken = generatedToken;
  state.generatedPortalTokenId = dataForUi.tokenId || null;
  if (dataForUi.token && dataForUi.tokenId) rememberPortalTokenOnDevice(session, dataForUi.tokenId, dataForUi.token, dataForUi.redemptionExpiresAt);
  if (out) {
    out.hidden = false;

    // "Buat Token..." hanya tampil sebagai state sebelum token berhasil dibuat.
    // Setelah generate berhasil, title ini sengaja disembunyikan.
    const titleEl = document.getElementById("generatedPortalTokenTitle");
    if (titleEl) titleEl.hidden = true;

    const tokenEl = document.getElementById("generatedPortalTokenToken");
    const createdEl = document.getElementById("generatedPortalTokenCreated");
    const statusEl = document.getElementById("generatedPortalTokenStatus");
    if (tokenEl) tokenEl.textContent = dataForUi.token ? `Token Access : ${dataForUi.token}` : "Token Access : —";
    __jyyrHideGeneratedTokenTitle();
    if (createdEl) createdEl.textContent = `Dibuat ${Number(dataForUi.createdCount || 1)} token · ${broadcastDate(dataForUi.createdAt || new Date().toISOString())}`;
    if (statusEl) {
      statusEl.textContent =
        `Token AKTIF · Redemption sampai ${broadcastDate(
          dataForUi.redemptionExpiresAt ||
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        )}`;
    }
  }
  state.tokenHistoryPage = 0;
  state.tokenStatusNotified = false;
  await Promise.all([loadPortalTokenStatus(session), loadPortalTokenHistory(session), loadPortalTokenDistributionStatus(session)]);
}

async function publishPortalTokenById(session, tokenId) {
  if (!isPortalTokenId(tokenId)) throw new Error("Token ID tidak valid.");
  const response = await ownerRequest("/api/owner/token/publish", session, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token_id: tokenId }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal menyebarkan token.");
  return data;
}

async function unpublishPortalTokenById(session, tokenId) {
  if (!isPortalTokenId(tokenId)) throw new Error("Token ID tidak valid.");
  const response = await ownerRequest("/api/owner/token/unpublish", session, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token_id: tokenId }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal menghentikan publikasi token.");
  return data;
}

async function revokePortalTokenById(session, tokenId) {
  if (!isPortalTokenId(tokenId)) throw new Error("Token ID tidak valid.");
  const response = await ownerRequest("/api/owner/token/revoke", session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token_id: tokenId }),
  });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal mencabut token.");
  return data;
}

async function revokePortalToken(session, tokenId = state.activePortalTokenId) {
  if (!isPortalTokenId(tokenId)) return;
  await revokePortalTokenById(session, tokenId);
  if (state.generatedPortalTokenId === tokenId) {
    document.getElementById("generatedPortalToken")?.setAttribute("hidden", "");
    state.generatedPortalToken = null;
    state.generatedPortalTokenId = null;
  }
  state.tokenHistoryPage = 0;
  state.tokenStatusNotified = false;
  await loadPortalTokenStatus(session);
  await loadPortalTokenHistory(session);
}

/* =========================================================
   STATISTICS / HEALTH / MAINTENANCE
========================================================= */
