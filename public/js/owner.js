const icon = (name) => window.icon?.(name) || "";

[
  ["ownerAvatar", "crown"], ["ownerAvatarLarge", "crown"], ["refreshIcon", "refresh"],
  ["logoutIcon", "logout"], ["logoutIconTop", "logout"], ["homeIcon", "home"],
  ["broadcastIcon", "broadcast"], ["trashIcon", "trash"], ["editIcon", "edit"],
  ["messageIcon", "message"], ["bellIcon", "bell"], ["plusIcon", "plus"],
  ["plusIcon2", "plus"], ["shieldIcon", "shield"], ["lockIcon", "lock"],
  ["settingsIcon", "settings"], ["checkIcon", "check"], ["refreshIcon2", "refresh"], ["copyTokenIcon", "copy"], ["refreshTokenHistoryIcon", "refresh"],
  ["tabStatistikIcon", "chart"], ["tabMemberIcon", "users"], ["tabBroadcastIcon", "broadcast"],
  ["tabNotifikasiIcon", "bell"], ["tabTokenIcon", "lock"], ["tabSecurityIcon", "shield"], ["tabSistemIcon", "settings"],
  ["statisticsTitleIcon", "chart"], ["memberTitleIcon", "users"], ["broadcastTitleIcon", "broadcast"],
  ["broadcastHistoryTitleIcon", "receipt"], ["messageTitleIcon", "message"], ["faqTitleIcon", "help"], ["helpTitleIcon", "help"],
  ["portalTokenTitleIcon", "lock"], ["tokenHistoryTitleIcon", "receipt"], ["tokenRequestsTitleIcon", "bell"],
  ["securityTitleIcon", "shield"], ["loginTitleIcon", "lock"], ["systemTitleIcon", "settings"], ["healthTitleIcon", "chart"],
  ["closeMemberIcon", "close"], ["saveMemberIcon", "check"], ["sendMessageIcon", "arrowRight"],
  ["generateTokenIcon", "plus"], ["revokeTokenIcon", "lock"],
].forEach(([id, name]) => {
  const el = document.getElementById(id);
  if (el) el.innerHTML = icon(name);
});

const state = {
  session: null,
  memberPage: 0,
  memberLimit: 5,
  memberTotal: 0,
  memberEditingId: null,
  loginPage: 0,
  loginLimit: 5,
  loginTotal: 0,
  faqEditingId: null,
  helpEditingId: null,
  activeConversationId: null,
  editingBroadcastId: null,
  activePortalTokenId: null,
  generatedPortalToken: null,
  tokenHistoryPage: 0,
  tokenHistoryLimit: 5,
  tokenHistoryTotal: 0,
  tokenStatusNotified: false,
  generatedPortalTokenId: null,
};

const PORTAL_TOKEN_VAULT_KEY = "jyyramprem.ownerPortalTokens.v2";

// Frontend UUID validation for token actions. Keep this local so token history
// rendering never depends on a server-only helper.
function isPortalTokenId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readPortalTokenVault() {
  try {
    const raw = localStorage.getItem(PORTAL_TOKEN_VAULT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePortalTokenVault(vault) {
  try {
    localStorage.setItem(PORTAL_TOKEN_VAULT_KEY, JSON.stringify(vault));
  } catch {
    // Local storage is only a secondary recovery path. Server/database remains primary.
  }
}

function rememberPortalTokenOnDevice(session, tokenId, token, expiresAt) {
  if (!session?.user?.id || !tokenId || !token) return;
  const vault = readPortalTokenVault();
  const ownerKey = String(session.user.id);
  if (!vault[ownerKey] || typeof vault[ownerKey] !== "object") vault[ownerKey] = {};
  vault[ownerKey][String(tokenId)] = {
    token: String(token).trim().toUpperCase(),
    expiresAt: expiresAt || null,
    savedAt: new Date().toISOString(),
  };
  writePortalTokenVault(vault);
}

function findRememberedPortalToken(session, row) {
  if (!session?.user?.id || !row?.id) return null;
  const vault = readPortalTokenVault();
  const item = vault?.[String(session.user.id)]?.[String(row.id)];
  if (!item?.token) return null;
  if (item.expiresAt) {
    const expiry = Date.parse(item.expiresAt);
    if (Number.isFinite(expiry) && expiry <= Date.now()) return null;
  }
  return String(item.token).trim().toUpperCase() || null;
}

const redirectLogin = () => location.replace("/login.html");
const redirectHome = () => location.replace("/home.html");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ownerNotice(message, type = "error", title = "") {
  window.JYYRNotify?.show(message, type, title ? { title } : {});
}

function memberBadge(status) {
  const label = status === "banned" ? "Banned" : status === "suspended" ? "Suspended" : "Active";
  const cls = status === "active" ? "green" : status === "banned" ? "red" : "yellow";
  return `<span class="badge ${cls}">${label}</span>`;
}

function broadcastStatusBadge(status) {
  const labels = { draft: "Draft", scheduled: "Scheduled", sending: "Sending", sent: "Sent", cancelled: "Cancelled", failed: "Failed" };
  const cls = status === "sent" ? "green" : status === "failed" || status === "cancelled" ? "red" : status === "scheduled" ? "yellow" : "";
  return `<span class="badge ${cls}">${escapeHtml(labels[status] || status)}</span>`;
}

function broadcastDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

async function copyGeneratedPortalToken() {
  const token = state.generatedPortalToken;
  if (!token) return;
  try {
    await navigator.clipboard.writeText(token);
  } catch {
    const area = document.createElement("textarea");
    area.value = token;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  ownerNotice("Token berhasil disalin.", "success");
}

function ownerRequest(path, session, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
}

async function parseJson(response) {
  return response.json().catch(() => ({}));
}

async function requireSession() {
  const session = await AMAuth.getSession().catch(() => null);
  if (!session?.access_token) {
    redirectLogin();
    return null;
  }
  state.session = session;
  return session;
}

async function verifyOwner(session) {
  const response = await ownerRequest("/api/owner/status", session);
  const data = await parseJson(response);
  if (response.status === 401) {
    redirectLogin();
    return null;
  }
  if (response.status === 403 || !response.ok || data.owner !== true) {
    redirectHome();
    return null;
  }
  return data;
}

function setOwnerIdentity(user) {
  const name = user?.user_metadata?.username || user?.user_metadata?.nickname || user?.email?.split("@")[0] || "Owner";
  document.querySelectorAll("[data-user-name]").forEach((el) => { el.textContent = name; });
  document.querySelectorAll("[data-user-email]").forEach((el) => { el.textContent = user?.email || "—"; });
  const registered = document.getElementById("registeredAt");
  if (registered) registered.textContent = user?.created_at ? new Date(user.created_at).toLocaleDateString("id-ID", { dateStyle: "medium" }) : "—";
  const lastLogin = document.getElementById("lastLogin");
  if (lastLogin) lastLogin.textContent = user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "—";
  const securityOwnerName = document.getElementById("securityOwnerName");
  const securityOwnerEmail = document.getElementById("securityOwnerEmail");
  if (securityOwnerName) securityOwnerName.textContent = name;
  if (securityOwnerEmail) securityOwnerEmail.textContent = user?.email || "—";
}

function setupTabs() {
  document.querySelectorAll("[data-section]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll("[data-section]").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".owner-section").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.section)?.classList.add("active");
      const session = state.session || await requireSession();
      if (!session) return;
      try {
        if (btn.dataset.section === "notifikasi") {
          await Promise.all([loadConversations(), loadContentAdmin(session)]);
        } else if (btn.dataset.section === "token") {
          await Promise.all([loadPortalTokenStatus(session), loadPortalTokenHistory(session), loadPortalTokenRequests(session)]);
        } else if (btn.dataset.section === "security") {
          await loadLoginActivity(session);
        } else if (btn.dataset.section === "sistem") {
          await loadMaintenance(session);
        }
      } catch (error) {
        ownerNotice(error.message);
      }
    });
  });
}

/* Legacy pagination hooks retained for compatibility: memberPrev/memberNext, loginPrev/loginNext. */
/* =========================================================
   PAGINATION CONTROLS
   - Previous (<) appears from page 4 onward.
   - First (<<) appears from page 5 onward.
   - Page numbers remain compact and mobile friendly.
========================================================= */
function renderPaginationControls(containerId, pageIndex, pageCount, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.max(1, Number(pageCount) || 1);
  const current = Math.min(Math.max(Number(pageIndex) || 0, 0), totalPages - 1);
  const last = totalPages - 1;

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  // Compact pagination: ALWAYS show at most 3 page numbers.
  // <  appears from page 4 onward (1-based).
  // << appears from page 5 onward (1-based).
  let start = Math.max(0, current - 1);
  if (start + 3 > totalPages) start = Math.max(0, totalPages - 3);
  const end = Math.min(totalPages - 1, start + 2);

  const parts = [];
  if (current >= 3) {
    parts.push('<button class="btn pagination-btn pagination-jump" type="button" data-page="' + (current - 1) + '" aria-label="Previous page">&lt;</button>');
  }
  if (current >= 4) {
    parts.push('<button class="btn pagination-btn pagination-jump" type="button" data-page="0" aria-label="First page">&lt;&lt;</button>');
  }

  for (let page = start; page <= end; page += 1) {
    parts.push('<button class="btn pagination-btn pagination-number ' + (page === current ? 'active' : '') + '" type="button" data-page="' + page + '" aria-label="Halaman ' + (page + 1) + '" ' + (page === current ? 'aria-current="page"' : '') + '>' + (page + 1) + '</button>');
  }

  if (current < last) {
    parts.push('<button class="btn pagination-btn pagination-jump" type="button" data-page="' + (current + 1) + '" aria-label="Next page">&gt;</button>');
    parts.push('<button class="btn pagination-btn pagination-jump" type="button" data-page="' + last + '" aria-label="Last page">&gt;&gt;</button>');
  }

  container.innerHTML = parts.join("");
  container.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = Number(button.dataset.page);
      if (!Number.isInteger(target) || target === current || target < 0 || target > last) return;
      button.disabled = true;
      try {
        await onPageChange(target);
      } catch (error) {
        ownerNotice(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });
}

/* =========================================================
   MEMBER MANAGEMENT
========================================================= */
function renderMembers(data) {
  const list = document.getElementById("memberList");
  const total = Number(data.total) || 0;
  state.memberTotal = total;
  const pageCount = Math.max(1, Math.ceil(total / state.memberLimit));
  const page = Math.min(state.memberPage, pageCount - 1);
  state.memberPage = page;
  document.getElementById("memberTotal")?.replaceChildren(document.createTextNode(`Total Member : ${total}`));
  renderPaginationControls("memberPaginationControls", page, pageCount, async (target) => {
    state.memberPage = target;
    await loadMembers(state.session);
  });
  const members = Array.isArray(data.members) ? data.members : [];
  if (!list) return;
  if (!members.length) {
    list.innerHTML = `<div class="member-row"><div><strong>Tidak ada member</strong><small>Coba ubah pencarian atau filter.</small></div></div>`;
    return;
  }
  list.innerHTML = members.map((m) => {
    const id = escapeHtml(m.user_id);
    const email = escapeHtml(m.email || "—");
    const name = escapeHtml(m.display_name || email.split("@")[0]);
    const status = escapeHtml(m.status || "active");
    const notes = m.notes ? `<p class="member-notes">${escapeHtml(m.notes)}</p>` : "";
    return `<article class="member-row" data-member-id="${id}">
      <div class="member-main">
        <div class="member-identity">
          <div class="member-name-wrap">
            <strong class="member-name">${name}</strong>
            <small class="member-email">${email}</small>
          </div>
          ${memberBadge(status)}
        </div>
        ${notes}
      </div>
      <div class="member-actions" aria-label="Aksi member">
        <button class="btn member-edit" data-id="${id}" type="button">${icon("edit")}<span>Detail/Edit</span></button>
        <button class="btn member-action" data-action="suspend" data-id="${id}" type="button" ${status !== "active" ? "disabled" : ""}>${icon("lock")}<span>Suspend</span></button>
        <button class="btn member-action" data-action="ban" data-id="${id}" type="button" ${status === "banned" ? "disabled" : ""}>${icon("shield")}<span>Ban</span></button>
        <button class="btn member-action" data-action="unban" data-id="${id}" type="button" ${status === "active" ? "disabled" : ""}>${icon("unlock")}<span>Unban</span></button>
        <button class="btn danger member-delete" data-id="${id}" type="button">${icon("trash")}<span>Hapus Akun</span></button>
      </div>
    </article>`;
  }).join("");
}

async function loadMembers(session) {
  const search = document.getElementById("memberSearch")?.value?.trim() || "";
  const status = document.getElementById("memberStatusFilter")?.value || "";
  const query = new URLSearchParams({ limit: String(state.memberLimit), offset: String(state.memberPage * state.memberLimit) });
  if (search) query.set("search", search.slice(0, 100));
  if (status) query.set("status", status);
  const response = await ownerRequest(`/api/owner/members?${query.toString()}`, session);
  const data = await parseJson(response);
  if (response.status === 401) return redirectLogin();
  if (response.status === 403) return redirectHome();
  if (!response.ok) throw new Error(data.error || "Member gagal dimuat");
  renderMembers(data);
}

async function openMemberEditor(session, id) {
  const response = await ownerRequest(`/api/owner/members/${encodeURIComponent(id)}`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Detail member gagal dimuat.");
  const member = data.member || {};
  state.memberEditingId = id;
  document.getElementById("memberDisplayName").value = member.display_name || "";
  document.getElementById("memberNotes").value = member.notes || "";
  document.getElementById("memberEditorMeta").textContent = `${member.email || "—"} · ${member.status || "active"}`;
  document.getElementById("memberEditorStatus").textContent = "";
  document.getElementById("memberEditor").hidden = false;
  document.getElementById("memberDisplayName")?.focus();
}

async function saveMemberEditor(session) {
  if (!state.memberEditingId) throw new Error("Member belum dipilih.");
  const display_name = document.getElementById("memberDisplayName")?.value.trim() || "";
  const notes = document.getElementById("memberNotes")?.value || "";
  const response = await ownerRequest(`/api/owner/members/${encodeURIComponent(state.memberEditingId)}`, session, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name, notes }),
  });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal memperbarui member.");
  document.getElementById("memberEditorStatus").textContent = "Profil member berhasil diperbarui.";
  ownerNotice("Profil member berhasil diperbarui.", "success");
  await loadMembers(session);
}

async function memberAction(session, id, action) {
  const reason = await window.JYYRNotify?.prompt?.("Alasan perubahan status (opsional):", {
    title: "Perubahan Status Member",
    placeholder: "Masukkan alasan (opsional)",
    value: "",
    confirmText: "Simpan",
    cancelText: "Batal",
  });
  if (reason === null || reason === undefined) return;
  const response = await ownerRequest(`/api/owner/members/${encodeURIComponent(id)}/${action}`, session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason.slice(0, 500) }),
  });
  const data = await parseJson(response);
  if (response.status === 401) return redirectLogin();
  if (response.status === 403) return redirectHome();
  if (!response.ok) throw new Error(data.error || "Perubahan member gagal");
  await loadMembers(session);
}

/* =========================================================
   PORTAL ACCESS TOKEN
========================================================= */
async function loadPortalTokenStatus(session) {
  const response = await ownerRequest("/api/owner/token/status", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Status token gagal dimuat.");
  const token = data?.token || { status: "none" };
  const statusEl = document.getElementById("ownerTokenStatus");
  const revoke = document.getElementById("revokePortalToken");
  state.activePortalTokenId = token.status === "active" ? token.id : null;
  if (statusEl) {
    const activeCount = Number(data?.active_count ?? data?.activeCount) || 0;
    statusEl.textContent = token.status === "active"
      ? `${activeCount} token aktif · token terbaru berlaku sampai ${broadcastDate(token.expires_at)}.`
      : activeCount ? `${activeCount} token aktif.` : "Tidak ada token aktif.";
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
  const labels = { active: "ACTIVE", used: "USED", expired: "EXPIRED", revoked: "REVOKED" };
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
      const serverToken = /^[A-F0-9]{20}$/.test(String(t.token || "").trim().toUpperCase())
        ? String(t.token).trim().toUpperCase()
        : null;
      const generatedToken = t.id && t.id === state.generatedPortalTokenId && /^[A-F0-9]{20}$/.test(String(state.generatedPortalToken || "").trim().toUpperCase())
        ? String(state.generatedPortalToken).trim().toUpperCase()
        : null;
      const newestToken = index === 0 && t.status === "active" && /^[A-F0-9]{20}$/.test(String(state.generatedPortalToken || "").trim().toUpperCase())
        ? String(state.generatedPortalToken).trim().toUpperCase()
        : null;
      // Always prefer a known full 20-character token. A masked preview is
      // only a last-resort display for legacy rows that cannot be recovered.
      const tokenValue = rememberedToken || serverToken || generatedToken || newestToken || null;
      const token = escapeHtml(tokenValue || t.preview || "—");
      if (tokenValue && t.id) rememberPortalTokenOnDevice(session, t.id, tokenValue, t.expires_at);
      const statusLabel = escapeHtml(labels[t.status] || t.status || "UNKNOWN");
      const statusClass = cls[t.status] || "blue";
      const created = escapeHtml(broadcastDate(t.created_at));
      const expires = escapeHtml(broadcastDate(t.expires_at));
      const used = t.used_at ? escapeHtml(broadcastDate(t.used_at)) : "—";
      const usedBy = t.used_email ? `<small class="token-history-usedby">${escapeHtml(t.used_email)}</small>` : `<small class="token-history-usedby">Belum digunakan</small>`;
      const canRevoke = t.status === "active" && isPortalTokenId(t.id);
      const action = canRevoke
        ? `<button class="btn danger token-history-revoke" type="button" data-revoke-token-id="${escapeHtml(t.id)}" data-revoke-token="${escapeHtml(tokenValue || t.preview || "token aktif")}">Cabut</button>`
        : "—";
      return `<tr data-token-id="${escapeHtml(t.id || "")}"><td><div class="token-history-token">${token}</div>${usedBy}</td><td><span class="badge ${statusClass}">${statusLabel}</span></td><td><strong>${created}</strong><small>Expired ${expires}</small></td><td><strong>${used}</strong></td><td class="token-history-action">${action}</td></tr>`;
    }).join("");
    list.innerHTML = `<div class="table-wrap token-history-table-wrap"><table class="table token-history-table"><thead><tr><th>Token</th><th>Status</th><th>Dibuat</th><th>Digunakan</th><th>Aksi</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  renderPaginationControls("tokenHistoryControls", state.tokenHistoryPage, pageCount, async (target) => {
    state.tokenHistoryPage = target;
    await loadPortalTokenHistory(state.session);
  });
}

async function loadPortalTokenRequests(session) {
  const response = await ownerRequest("/api/owner/token/requests?limit=50&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Request token gagal dimuat.");
  const badge = document.getElementById("tokenRequestPending");
  if (badge) badge.textContent = `${Number(data.pending) || 0} pending`;
  const list = document.getElementById("tokenRequestList");
  const rows = Array.isArray(data.requests) ? data.requests : [];
  if (!list) return;
  list.innerHTML = rows.length ? rows.map((r) => `<div><strong>${escapeHtml(r.email || r.user_id)}</strong><small>${escapeHtml(r.status)} · ${escapeHtml(broadcastDate(r.created_at))}</small></div>`).join("") : `<div>Belum ada request token.</div>`;
}

async function generatePortalToken(session) {
  const response = await ownerRequest("/api/owner/token/generate", session, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membuat token.");
  const out = document.getElementById("generatedPortalToken");
  state.generatedPortalToken = data.token || null;
  state.generatedPortalTokenId = data.tokenId || null;
  if (data.token && data.tokenId) rememberPortalTokenOnDevice(session, data.tokenId, data.token, data.expiresAt);
  if (out) {
    out.hidden = false;
    const text = document.getElementById("generatedPortalTokenText");
    if (text) text.textContent = data.token
      ? `${data.token} · berlaku sampai ${broadcastDate(data.expiresAt)}.`
      : "Token berhasil dibuat, tetapi server tidak mengembalikan plaintext token.";
    else out.textContent = data.token
      ? `TOKEN: ${data.token} · berlaku sampai ${broadcastDate(data.expiresAt)}.`
      : "Token berhasil dibuat, tetapi server tidak mengembalikan plaintext token.";
  }
  state.tokenHistoryPage = 0;
  state.tokenStatusNotified = false;
  await loadPortalTokenStatus(session);
  await loadPortalTokenHistory(session);
  await loadPortalTokenRequests(session);
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
function renderOwnerStatistics(statistics) {
  const buckets = Array.isArray(statistics.sevenDays) ? statistics.sevenDays : [];
  const max = Math.max(1, ...buckets.map((item) => Number(item.count) || 0));
  const chart = document.getElementById("ownerChart");
  if (chart) {
    chart.innerHTML = buckets.map((item) => {
      const count = Number(item.count) || 0;
      const label = item.date ? new Date(`${item.date}T00:00:00Z`).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" }) : "—";
      return `<div class="bar-col"><span class="bar-value">${count}</span><div class="bar" style="height:${Math.max(4, (count / max) * 82)}%"></div><span class="bar-label">${label}</span></div>`;
    }).join("");
  }
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(Number(value) || 0); };
  set("todayCount", statistics.today); set("weekCount", statistics.week); set("monthCount", statistics.month);
}

async function loadHealth(session) {
  const response = await ownerRequest("/api/owner/health", session);
  const data = await parseJson(response);
  const db = data.database === "connected" && response.ok;
  const dbEl = document.getElementById("healthDatabase");
  const sbEl = document.getElementById("healthSupabase");
  const authEl = document.getElementById("healthAuth");
  const ownerHealth = document.getElementById("ownerHealth");
  if (dbEl) dbEl.textContent = `Database · ${db ? "Connected" : "Error"}`;
  if (sbEl) sbEl.textContent = `Supabase · ${db ? "Reachable" : "Error"}`;
  if (authEl) authEl.textContent = "Auth · Session verified";
  if (ownerHealth) ownerHealth.textContent = db ? "Supabase / Auth / Database Online" : "Owner health check error";
}

async function loadMaintenance(session) {
  const response = await ownerRequest("/api/owner/maintenance", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca maintenance.");
  const settings = data.settings || {};
  const button = document.getElementById("maintenanceToggle");
  const box = document.querySelector(".maintenance");
  if (button) {
    button.dataset.enabled = settings.maintenance_enabled ? "1" : "0";
    button.textContent = settings.maintenance_enabled ? "Matikan Maintenance" : "Aktifkan Maintenance";
  }
  if (box) box.textContent = settings.maintenance_enabled ? (settings.maintenance_message || "Maintenance aktif") : "Web normal — maintenance OFF";
}

/* =========================================================
   BROADCAST MANAGEMENT
========================================================= */
function toDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderBroadcasts(data) {
  const list = document.getElementById("broadcastList");
  const total = document.getElementById("broadcastTotal");
  if (total) total.textContent = `Total: ${Number(data.total) || 0}`;
  if (!list) return;
  const rows = Array.isArray(data.broadcasts) ? data.broadcasts : [];
  if (!rows.length) {
    list.innerHTML = `<div class="broadcast-card"><strong>Belum ada broadcast</strong><p>Buat draft atau jadwal broadcast pertama.</p></div>`;
    return;
  }
  list.innerHTML = rows.map((b) => {
    const id = escapeHtml(b.id);
    const editable = b.status === "draft" || b.status === "scheduled";
    const deletable = b.status === "draft" || b.status === "cancelled" || b.status === "failed";
    const executable = b.status === "draft" || b.status === "scheduled";
    return `<article class="broadcast-card">
      <div class="broadcast-main">
        <div class="broadcast-title-row"><strong>${escapeHtml(b.title)}</strong>${broadcastStatusBadge(b.status)}</div>
        <p>${escapeHtml(b.message)}</p>
        <small>Target: ${escapeHtml(b.recipient_filter)} · Dibuat: ${escapeHtml(broadcastDate(b.created_at))}${b.scheduled_at ? ` · Jadwal: ${escapeHtml(broadcastDate(b.scheduled_at))}` : ""}</small>
      </div>
      <div class="broadcast-actions">
        <button class="round-btn broadcast-execute" type="button" data-id="${id}" ${executable ? "" : "disabled"} aria-label="Jalankan broadcast"><span>${icon("broadcast")}</span></button>
        <button class="round-btn danger broadcast-delete" type="button" data-id="${id}" ${deletable ? "" : "disabled"} aria-label="Hapus broadcast"><span>${icon("trash")}</span></button>
        <button class="round-btn broadcast-edit" type="button" data-id="${id}" ${editable ? "" : "disabled"} aria-label="Edit broadcast"><span>${icon("edit")}</span></button>
      </div>
    </article>`;
  }).join("");
}

async function loadBroadcasts(session) {
  const response = await ownerRequest("/api/owner/broadcasts?limit=20&offset=0", session);
  const data = await parseJson(response);
  if (response.status === 401) return redirectLogin();
  if (response.status === 403) return redirectHome();
  if (!response.ok) throw new Error(data.error || "Broadcast gagal dimuat");
  renderBroadcasts(data);
}

function resetBroadcastForm() {
  state.editingBroadcastId = null;
  document.getElementById("broadcastTitle").value = "";
  document.getElementById("broadcastMessage").value = "";
  document.getElementById("broadcastStatus").value = "draft";
  document.getElementById("broadcastFilter").value = "all";
  document.getElementById("broadcastScheduledAt").value = "";
  document.getElementById("broadcastScheduleWrap").hidden = true;
  document.getElementById("broadcastCancelEdit").hidden = true;
  document.getElementById("broadcastSave").textContent = "Simpan Broadcast";
}

async function editBroadcast(session, id) {
  const response = await ownerRequest(`/api/owner/broadcasts/${encodeURIComponent(id)}`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Broadcast gagal dimuat");
  const b = data.broadcast || {};
  state.editingBroadcastId = b.id;
  document.getElementById("broadcastTitle").value = b.title || "";
  document.getElementById("broadcastMessage").value = b.message || "";
  document.getElementById("broadcastStatus").value = b.status || "draft";
  document.getElementById("broadcastFilter").value = b.recipient_filter || "all";
  document.getElementById("broadcastScheduledAt").value = toDatetimeLocal(b.scheduled_at);
  document.getElementById("broadcastScheduleWrap").hidden = b.status !== "scheduled";
  document.getElementById("broadcastCancelEdit").hidden = false;
  document.getElementById("broadcastSave").textContent = "Simpan Perubahan";
  document.getElementById("broadcastTitle")?.focus();
}

async function saveBroadcast(session) {
  const title = document.getElementById("broadcastTitle")?.value.trim() || "";
  const message = document.getElementById("broadcastMessage")?.value.trim() || "";
  const status = document.getElementById("broadcastStatus")?.value || "draft";
  const recipient_filter = document.getElementById("broadcastFilter")?.value || "all";
  const scheduledLocal = document.getElementById("broadcastScheduledAt")?.value || "";
  const scheduled_at = scheduledLocal ? new Date(scheduledLocal).toISOString() : null;
  if (!title || !message) throw new Error("Judul dan pesan wajib diisi.");
  if (status === "scheduled" && !scheduled_at) throw new Error("Jadwal wajib diisi.");

  const statusLabels = { draft: "Draf", scheduled: "Terjadwal", sending: "Mengirim", sent: "Terkirim" };
  const statusLabel = statusLabels[status] || status;
  const confirmationMessage = status === "scheduled"
    ? `Simpan broadcast sebagai terjadwal?\n\nJadwal: ${broadcastDate(scheduled_at)}\nTarget: ${recipient_filter}\n\nBroadcast akan tetap terjadwal sampai waktunya tiba.`
    : status === "draft"
      ? `Simpan broadcast sebagai draf?\n\nTarget: ${recipient_filter}\n\nBroadcast belum akan dikirim.`
      : `Simpan perubahan broadcast dengan status ${statusLabel}?\n\nTarget: ${recipient_filter}`;
  const confirmed = await window.JYYRNotify?.confirm?.(confirmationMessage, {
    title: state.editingBroadcastId ? "Konfirmasi Perubahan Broadcast" : "Konfirmasi Broadcast",
    confirmText: status === "scheduled" ? "Jadwalkan" : status === "draft" ? "Simpan Draf" : "Simpan",
    cancelText: "Batal",
  });
  if (!confirmed) return false;

  const path = state.editingBroadcastId ? `/api/owner/broadcasts/${encodeURIComponent(state.editingBroadcastId)}` : "/api/owner/broadcasts";
  const response = await ownerRequest(path, session, {
    method: state.editingBroadcastId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, message, status, scheduled_at, recipient_filter }),
  });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Broadcast gagal disimpan");
  resetBroadcastForm();
  await loadBroadcasts(session);
  return true;
}

async function deleteBroadcast(session, id) {
  const confirmed = await window.JYYRNotify?.confirm?.("Hapus broadcast ini?", {
    title: "Hapus Broadcast",
    confirmText: "Hapus",
    cancelText: "Batal",
    danger: true,
  });
  if (!confirmed) return;
  const response = await ownerRequest(`/api/owner/broadcasts/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Broadcast gagal dihapus");
  await loadBroadcasts(session);
}

async function executeBroadcast(session, id) {
  const confirmed = await window.JYYRNotify?.confirm?.("Jalankan broadcast sekarang? Broadcast yang berhasil akan berstatus sent dan membuat notifikasi untuk target.", {
    title: "Jalankan Broadcast",
    confirmText: "Jalankan",
    cancelText: "Batal",
  });
  if (!confirmed) return;
  const response = await ownerRequest(`/api/owner/broadcasts/${encodeURIComponent(id)}/execute`, session, { method: "POST" });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Broadcast gagal dijalankan");
  ownerNotice(`Broadcast terkirim ke ${Number(data.recipients) || 0} member.`, "success");
  await loadBroadcasts(session);
}

/* =========================================================
   MESSAGING
========================================================= */
function renderConversations(data) {
  const list = document.getElementById("conversationList");
  if (!list) return;
  const rows = Array.isArray(data.conversations) ? data.conversations : [];
  if (!rows.length) {
    list.innerHTML = `<div class="member-row"><strong>Belum ada percakapan</strong><small>Buat percakapan dari Member UUID.</small></div>`;
    return;
  }
  list.innerHTML = rows.map((c) => `<button class="member-row conversation-row" type="button" data-conversation-id="${escapeHtml(c.conversation_id)}"><div><strong>${escapeHtml(c.display_name || c.email || c.member_user_id)}</strong><small>${escapeHtml(c.last_message || "Belum ada pesan")}</small></div><div>${memberBadge(c.status || "active")}<small>${Number(c.unread_count) || 0} belum dibaca</small></div></button>`).join("");
}

async function loadConversations() {
  const session = state.session || await requireSession();
  if (!session) return;
  const response = await ownerRequest("/api/owner/messages?limit=20&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal memuat percakapan.");
  renderConversations(data);
}

async function openConversation(id) {
  const session = state.session || await requireSession();
  if (!session) return;
  const response = await ownerRequest(`/api/owner/messages/${encodeURIComponent(id)}?limit=100&offset=0`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membuka percakapan.");
  state.activeConversationId = id;
  document.getElementById("messageThread").hidden = false;
  document.getElementById("messageThreadHead").textContent = `${data.member?.display_name || data.member?.email || data.member?.user_id || "Member"} · ${data.member?.status || "active"}`;
  document.getElementById("messageThreadList").innerHTML = (data.messages || []).map((m) => `<div class="message-bubble"><strong>${m.sender_user_id === data.member?.user_id ? "Member" : "Owner"}</strong><p>${escapeHtml(m.body)}</p><small>${escapeHtml(broadcastDate(m.sent_at))}</small></div>`).join("") || `<div class="status info">Belum ada pesan.</div>`;
}

async function startConversation() {
  const memberId = document.getElementById("messageMemberId")?.value.trim() || "";
  if (!memberId) throw new Error("Member UUID wajib diisi.");
  const session = state.session || await requireSession();
  if (!session) return;
  const response = await ownerRequest("/api/owner/messages", session, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ member_id: memberId }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membuat percakapan.");
  await loadConversations();
  await openConversation(data.conversation.id);
}

async function sendOwnerMessage() {
  if (!state.activeConversationId) throw new Error("Pilih percakapan terlebih dahulu.");
  const body = document.getElementById("messageBody")?.value.trim() || "";
  if (!body) throw new Error("Pesan wajib diisi.");
  const session = state.session || await requireSession();
  if (!session) return;
  const response = await ownerRequest(`/api/owner/messages/${encodeURIComponent(state.activeConversationId)}`, session, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal mengirim pesan.");
  document.getElementById("messageBody").value = "";
  await openConversation(state.activeConversationId);
  await loadConversations();
}

/* =========================================================
   FAQ / HELP CRUD
========================================================= */
function resetFaqForm() {
  state.faqEditingId = null;
  document.getElementById("faqQuestion").value = "";
  document.getElementById("faqAnswer").value = "";
  document.getElementById("faqCategory").value = "";
  document.getElementById("faqSortOrder").value = "0";
  document.getElementById("faqPublished").checked = true;
  document.getElementById("faqCancelEdit").hidden = true;
  document.getElementById("faqSave").textContent = "Tambah FAQ";
}

function resetHelpForm() {
  state.helpEditingId = null;
  document.getElementById("helpTitle").value = "";
  document.getElementById("helpContent").value = "";
  document.getElementById("helpCategory").value = "";
  document.getElementById("helpSortOrder").value = "0";
  document.getElementById("helpPublished").checked = true;
  document.getElementById("helpCancelEdit").hidden = true;
  document.getElementById("helpSave").textContent = "Tambah Artikel";
}

async function loadFaq(session) {
  const response = await ownerRequest("/api/owner/faq?limit=50&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca FAQ.");
  const list = document.getElementById("faqList");
  if (!list) return;
  const rows = Array.isArray(data.faq) ? data.faq : [];
  list.innerHTML = rows.length ? rows.map((x) => `<div class="owner-crud-row"><div><strong>${escapeHtml(x.question)}</strong><small>${escapeHtml(x.category || "Tanpa kategori")} · urutan ${Number(x.sort_order)||0} · ${x.published ? "published" : "draft"}</small><p>${escapeHtml(x.answer)}</p></div><div class="btn-row"><button class="btn faq-edit" type="button" data-id="${escapeHtml(x.id)}">Edit</button><button class="btn danger faq-delete" type="button" data-id="${escapeHtml(x.id)}">Hapus</button></div></div>`).join("") : `<div class="status info">Belum ada FAQ.</div>`;
}

async function saveFaq(session) {
  const question = document.getElementById("faqQuestion")?.value.trim() || "";
  const answer = document.getElementById("faqAnswer")?.value.trim() || "";
  const category = document.getElementById("faqCategory")?.value.trim() || null;
  const sort_order = Number(document.getElementById("faqSortOrder")?.value || 0);
  const published = document.getElementById("faqPublished")?.checked === true;
  if (!question || !answer) throw new Error("Question dan answer wajib diisi.");
  const path = state.faqEditingId ? `/api/owner/faq/${encodeURIComponent(state.faqEditingId)}` : "/api/owner/faq";
  const response = await ownerRequest(path, session, { method: state.faqEditingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, answer, category, sort_order: Number.isInteger(sort_order) ? sort_order : 0, published }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "FAQ gagal disimpan.");
  resetFaqForm();
  document.getElementById("faqStatus").textContent = "FAQ berhasil disimpan.";
  await loadFaq(session);
}

async function editFaq(session, id) {
  const response = await ownerRequest(`/api/owner/faq?limit=50&offset=0`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "FAQ gagal dimuat.");
  const item = (data.faq || []).find((x) => x.id === id);
  if (!item) throw new Error("FAQ tidak ditemukan di halaman saat ini.");
  state.faqEditingId = id;
  document.getElementById("faqQuestion").value = item.question || "";
  document.getElementById("faqAnswer").value = item.answer || "";
  document.getElementById("faqCategory").value = item.category || "";
  document.getElementById("faqSortOrder").value = String(Number(item.sort_order) || 0);
  document.getElementById("faqPublished").checked = item.published !== false;
  document.getElementById("faqCancelEdit").hidden = false;
  document.getElementById("faqSave").textContent = "Simpan Perubahan";
}

async function deleteFaq(session, id) {
  const confirmed = await window.JYYRNotify?.confirm?.("Hapus FAQ ini?", {
    title: "Hapus FAQ",
    confirmText: "Hapus",
    cancelText: "Batal",
    danger: true,
  });
  if (!confirmed) return;
  const response = await ownerRequest(`/api/owner/faq/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "FAQ gagal dihapus.");
  await loadFaq(session);
}

async function loadHelp(session) {
  const response = await ownerRequest("/api/owner/help?limit=50&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca Help Center.");
  const list = document.getElementById("helpList");
  if (!list) return;
  const rows = Array.isArray(data.help) ? data.help : [];
  list.innerHTML = rows.length ? rows.map((x) => `<div class="owner-crud-row"><div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.slug)} · ${escapeHtml(x.category || "Tanpa kategori")} · urutan ${Number(x.sort_order)||0} · ${x.published ? "published" : "draft"}</small><p>${escapeHtml(x.content)}</p></div><div class="btn-row"><button class="btn help-edit" type="button" data-id="${escapeHtml(x.id)}">Edit</button><button class="btn danger help-delete" type="button" data-id="${escapeHtml(x.id)}">Hapus</button></div></div>`).join("") : `<div class="status info">Belum ada artikel.</div>`;
}

function slugify(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 240) || "help";
}

async function saveHelp(session) {
  const title = document.getElementById("helpTitle")?.value.trim() || "";
  const content = document.getElementById("helpContent")?.value.trim() || "";
  const category = document.getElementById("helpCategory")?.value.trim() || null;
  const sort_order = Number(document.getElementById("helpSortOrder")?.value || 0);
  const published = document.getElementById("helpPublished")?.checked === true;
  if (!title || !content) throw new Error("Title dan content wajib diisi.");
  const slug = slugify(title);
  const path = state.helpEditingId ? `/api/owner/help/${encodeURIComponent(state.helpEditingId)}` : "/api/owner/help";
  const response = await ownerRequest(path, session, { method: state.helpEditingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, slug, content, category, sort_order: Number.isInteger(sort_order) ? sort_order : 0, published }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Help Center gagal disimpan.");
  resetHelpForm();
  document.getElementById("helpStatus").textContent = "Artikel berhasil disimpan.";
  await loadHelp(session);
}

async function editHelp(session, id) {
  const response = await ownerRequest("/api/owner/help?limit=50&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Help Center gagal dimuat.");
  const item = (data.help || []).find((x) => x.id === id);
  if (!item) throw new Error("Artikel tidak ditemukan di halaman saat ini.");
  state.helpEditingId = id;
  document.getElementById("helpTitle").value = item.title || "";
  document.getElementById("helpContent").value = item.content || "";
  document.getElementById("helpCategory").value = item.category || "";
  document.getElementById("helpSortOrder").value = String(Number(item.sort_order) || 0);
  document.getElementById("helpPublished").checked = item.published !== false;
  document.getElementById("helpCancelEdit").hidden = false;
  document.getElementById("helpSave").textContent = "Simpan Perubahan";
}

async function deleteHelp(session, id) {
  const confirmed = await window.JYYRNotify?.confirm?.("Hapus artikel Help Center ini?", {
    title: "Hapus Artikel",
    confirmText: "Hapus",
    cancelText: "Batal",
    danger: true,
  });
  if (!confirmed) return;
  const response = await ownerRequest(`/api/owner/help/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Artikel gagal dihapus.");
  await loadHelp(session);
}

/* =========================================================
   LOGIN ACTIVITY
========================================================= */
async function loadLoginActivity(session) {
  const query = new URLSearchParams({ limit: String(state.loginLimit), offset: String(state.loginPage * state.loginLimit) });
  const response = await ownerRequest(`/api/owner/login-activity?${query.toString()}`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca login activity.");
  state.loginTotal = Number(data.total) || 0;
  const pageCount = Math.max(1, Math.ceil(state.loginTotal / state.loginLimit));
  state.loginPage = Math.min(state.loginPage, pageCount - 1);
  const list = document.getElementById("loginActivityList");
  if (list) {
    list.innerHTML = (data.activity || []).map((x) => `<div><strong>${escapeHtml(x.email || x.display_name || x.user_id)}</strong><small>${escapeHtml(x.event || "login")} · ${x.success === false ? "failed" : "success"} · ${escapeHtml(x.created_at ? new Date(x.created_at).toLocaleString("id-ID") : "—")}</small>${x.ip_address ? `<small>IP: ${escapeHtml(x.ip_address)}</small>` : ""}</div>`).join("") || `<div>Belum ada aktivitas.</div>`;
  }
  const totalEl = document.getElementById("loginActivityTotal");
  if (totalEl) totalEl.textContent = `Total Login : ${state.loginTotal}`;
  renderPaginationControls("loginPaginationControls", state.loginPage, pageCount, async (target) => {
    state.loginPage = target;
    await loadLoginActivity(state.session);
  });
}

async function loadContentAdmin(session) {
  await Promise.all([loadFaq(session), loadHelp(session)]);
}

/* =========================================================
   EVENT BINDINGS
========================================================= */
function bindEvents() {
  setupTabs();

  document.getElementById("memberSearch")?.addEventListener("input", (() => {
    let timer;
    return async () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        state.memberPage = 0;
        try { await loadMembers(state.session); } catch (e) { ownerNotice(e.message); }
      }, 300);
    };
  })());

  document.getElementById("memberStatusFilter")?.addEventListener("change", async () => {
    state.memberPage = 0;
    try { await loadMembers(state.session); } catch (e) { ownerNotice(e.message); }
  });


  document.getElementById("memberList")?.addEventListener("click", async (event) => {
    const edit = event.target.closest(".member-edit");
    const actionButton = event.target.closest(".member-action");
    const deleteButton = event.target.closest(".member-delete");
    const session = state.session || await requireSession();
    if (!session) return;
    try {
      if (edit) return await openMemberEditor(session, edit.dataset.id);
      if (deleteButton) {
        const confirmed = await window.JYYRNotify?.confirm?.(
          "Hapus akun member ini secara permanen?\n\nSemua akses akun dan data member terkait akan dihapus. Tindakan ini tidak dapat dibatalkan.",
          {
            title: "Hapus Member",
            confirmText: "Hapus Member",
            cancelText: "Batal",
            danger: true,
          }
        );
        if (!confirmed) return;
        const response = await ownerRequest(`/api/owner/members/${encodeURIComponent(deleteButton.dataset.id)}`, session, {
          method: "DELETE",
        });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || "Gagal menghapus akun member.");
        ownerNotice("Akun member berhasil dihapus secara permanen.", "success");
        state.memberPage = 0;
        return await loadMembers(session);
      }
      if (actionButton && !actionButton.disabled) await memberAction(session, actionButton.dataset.id, actionButton.dataset.action);
    } catch (error) { ownerNotice(error.message); }
  });
  document.getElementById("memberEditorClose")?.addEventListener("click", () => {
    state.memberEditingId = null;
    document.getElementById("memberEditor").hidden = true;
  });
  document.getElementById("memberEditorSave")?.addEventListener("click", async () => {
    const session = state.session || await requireSession(); if (!session) return;
    try { await saveMemberEditor(session); } catch (e) { ownerNotice(e.message); }
  });

  document.getElementById("broadcastStatus")?.addEventListener("change", (event) => {
    document.getElementById("broadcastScheduleWrap").hidden = event.target.value !== "scheduled";
  });
  document.getElementById("broadcastCancelEdit")?.addEventListener("click", resetBroadcastForm);
  document.getElementById("broadcastSave")?.addEventListener("click", async () => {
    const session = state.session || await requireSession(); if (!session) return;
    const button = document.getElementById("broadcastSave"); button.disabled = true;
    try {
      const saved = await saveBroadcast(session);
      if (saved !== false) ownerNotice("Broadcast berhasil disimpan.", "success");
    } catch (e) { document.getElementById("broadcastFormStatus").textContent = e.message; ownerNotice(e.message); } finally { button.disabled = false; }
  });
  document.getElementById("broadcastList")?.addEventListener("click", async (event) => {
    const edit = event.target.closest(".broadcast-edit");
    const del = event.target.closest(".broadcast-delete");
    const execute = event.target.closest(".broadcast-execute");
    if (!edit && !del && !execute) return;
    const session = state.session || await requireSession(); if (!session) return;
    const id = (edit || del || execute).dataset.id;
    (edit || del || execute).disabled = true;
    try {
      if (edit) await editBroadcast(session, id);
      else if (del) await deleteBroadcast(session, id);
      else await executeBroadcast(session, id);
    } catch (e) { ownerNotice(e.message); }
  });

  document.getElementById("messageStart")?.addEventListener("click", async () => { try { await startConversation(); } catch (e) { ownerNotice(e.message); } });
  document.getElementById("messageSend")?.addEventListener("click", async () => { try { await sendOwnerMessage(); } catch (e) { ownerNotice(e.message); } });
  document.getElementById("conversationList")?.addEventListener("click", async (event) => { const row = event.target.closest("[data-conversation-id]"); if (!row) return; try { await openConversation(row.dataset.conversationId); } catch (e) { ownerNotice(e.message); } });

  document.getElementById("faqSave")?.addEventListener("click", async () => { const s=state.session||await requireSession(); if(!s)return; try{await saveFaq(s);ownerNotice("FAQ berhasil disimpan.","success");}catch(e){ownerNotice(e.message);} });
  document.getElementById("faqCancelEdit")?.addEventListener("click", resetFaqForm);
  document.getElementById("faqList")?.addEventListener("click", async (event) => { const edit=event.target.closest(".faq-edit"),del=event.target.closest(".faq-delete");if(!edit&&!del)return;const s=state.session||await requireSession();if(!s)return;try{if(edit)await editFaq(s,edit.dataset.id);else await deleteFaq(s,del.dataset.id);}catch(e){ownerNotice(e.message);} });
  document.getElementById("helpSave")?.addEventListener("click", async () => { const s=state.session||await requireSession(); if(!s)return; try{await saveHelp(s);ownerNotice("Artikel berhasil disimpan.","success");}catch(e){ownerNotice(e.message);} });
  document.getElementById("helpCancelEdit")?.addEventListener("click", resetHelpForm);
  document.getElementById("helpList")?.addEventListener("click", async (event) => { const edit=event.target.closest(".help-edit"),del=event.target.closest(".help-delete");if(!edit&&!del)return;const s=state.session||await requireSession();if(!s)return;try{if(edit)await editHelp(s,edit.dataset.id);else await deleteHelp(s,del.dataset.id);}catch(e){ownerNotice(e.message);} });


  document.getElementById("maintenanceToggle")?.addEventListener("click", async () => {
    const s=state.session||await requireSession();if(!s)return;const b=document.getElementById("maintenanceToggle");
    const enabled=b.dataset.enabled!=="1";b.disabled=true;
    const confirmed = await window.JYYRNotify?.confirm?.(enabled ? "Aktifkan mode maintenance sekarang? Member akan melihat halaman maintenance." : "Matikan mode maintenance sekarang dan buka akses member kembali?", {
      title: enabled ? "Aktifkan Maintenance" : "Nonaktifkan Maintenance",
      confirmText: enabled ? "Aktifkan" : "Matikan",
      cancelText: "Batal",
    });
    if (!confirmed) return;
    try{const r=await ownerRequest("/api/owner/maintenance",s,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,message:"Jyy'R Amprem Sedang Maintenance"})});const d=await parseJson(r);if(!r.ok)throw new Error(d.error||"Gagal mengubah maintenance.");await loadMaintenance(s);ownerNotice(enabled?"Maintenance diaktifkan.":"Maintenance dimatikan.","success");}catch(e){ownerNotice(e.message);}finally{b.disabled=false;}
  });

  document.getElementById("generatePortalToken")?.addEventListener("click", async () => {
    const s = state.session || await requireSession(); if (!s) return;
    const confirmed = await window.JYYRNotify?.confirm?.("Buat token portal owner baru? Token aktif yang lama dapat tetap digunakan sampai dicabut atau kedaluwarsa.", {
      title: "Generate Token Portal",
      confirmText: "Generate Token",
      cancelText: "Batal",
    });
    if (!confirmed) return;
    const b = document.getElementById("generatePortalToken"); b.disabled = true;
    try { await generatePortalToken(s); ownerNotice("Token baru berhasil dibuat.", "success"); } catch (e) { ownerNotice(e.message); } finally { b.disabled = false; }
  });
  document.getElementById("revokePortalToken")?.addEventListener("click", async () => {
    const s = state.session || await requireSession(); if (!s) return;
    const activeTokenId = state.activePortalTokenId;
    if (!isPortalTokenId(activeTokenId)) return;
    const tokenRow = Array.from(document.querySelectorAll(".token-history-table tbody tr[data-token-id]")).find((row) => row.dataset.tokenId === String(activeTokenId));
    const tokenText = tokenRow?.querySelector(".token-history-token")?.textContent?.trim() || "token aktif";
    const confirmed = await window.JYYRNotify?.confirm?.(`Verifikasi pencabutan\n\nToken ${tokenText} akan dicabut dan tidak dapat digunakan lagi.\nToken aktif lainnya tetap aman.\n\nLanjutkan?`, {
      title: "Verifikasi Pencabutan Token",
      confirmText: "Cabut Token",
      cancelText: "Batal",
      danger: true,
    });
    if (!confirmed) return;
    const b = document.getElementById("revokePortalToken"); b.disabled = true;
    try {
      await revokePortalToken(s, activeTokenId);
      ownerNotice("Token berhasil dicabut.", "success");
    } catch (e) { ownerNotice(e.message); }
    finally { await loadPortalTokenStatus(s).catch(() => {}); }
  });

  document.getElementById("portalTokenHistory")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-revoke-token-id]");
    if (!button) return;
    const s = state.session || await requireSession(); if (!s) return;
    const tokenId = button.dataset.revokeTokenId;
    const tokenText = button.dataset.revokeToken || "token aktif";
    if (!isPortalTokenId(tokenId)) return;
    const confirmed = await window.JYYRNotify?.confirm?.(`Verifikasi pencabutan\n\nToken ${tokenText} akan dicabut dan tidak dapat digunakan lagi.\nToken aktif lainnya tetap aman.\n\nLanjutkan?`, {
      title: "Verifikasi Pencabutan Token",
      confirmText: "Cabut Token",
      cancelText: "Batal",
      danger: true,
    });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await revokePortalToken(s, tokenId);
      ownerNotice("Token berhasil dicabut.", "success");
    } catch (e) {
      button.disabled = false;
      ownerNotice(e.message);
    }
  });

  document.getElementById("copyGeneratedPortalToken")?.addEventListener("click", copyGeneratedPortalToken);
  document.getElementById("refreshPortalTokenHistory")?.addEventListener("click", async () => {
    const s = state.session || await requireSession(); if (!s) return;
    try { await loadPortalTokenHistory(s); } catch (e) { ownerNotice(e.message); }
  });

  document.getElementById("refreshPage")?.addEventListener("click", () => location.reload());
  document.getElementById("logoutBtn")?.addEventListener("click", async () => { await AMAuth.signOut(); redirectLogin(); });
  document.getElementById("logoutBtnTop")?.addEventListener("click", async () => { await AMAuth.signOut(); redirectLogin(); });
}

async function loadPage() {
  const session = await requireSession();
  if (!session) return;
  const ownerStatus = await verifyOwner(session);
  if (!ownerStatus) return;
  setOwnerIdentity(ownerStatus.user || session.user);
  const [statisticsResponse] = await Promise.all([ownerRequest("/api/owner/statistics", session), loadHealth(session)]);
  const statisticsData = await parseJson(statisticsResponse);
  if (statisticsResponse.ok) renderOwnerStatistics(statisticsData.statistics || {});
  else console.warn("[OWNER] Statistics unavailable", statisticsData);

  await loadMembers(session).catch((e) => { console.error("[OWNER MEMBERS LOAD ERROR]", e); document.getElementById("memberList").innerHTML = `<div class="member-row"><div><strong>Member gagal dimuat</strong><small>${escapeHtml(e.message)}</small></div></div>`; });
  await loadBroadcasts(session).catch((e) => { console.error("[OWNER BROADCAST LOAD ERROR]", e); document.getElementById("broadcastList").innerHTML = `<div class="broadcast-card"><strong>Broadcast gagal dimuat</strong><p>${escapeHtml(e.message)}</p></div>`; });
  await Promise.all([loadConversations(), loadContentAdmin(session), loadLoginActivity(session), loadMaintenance(session), loadPortalTokenStatus(session), loadPortalTokenHistory(session), loadPortalTokenRequests(session)]).catch((e) => console.warn("[OWNER SECONDARY LOAD]", e));
}

bindEvents();
loadPage().catch((error) => { console.error("[OWNER LOAD ERROR]", error); const health=document.getElementById("ownerHealth");if(health)health.textContent="Owner console gagal dimuat"; });
