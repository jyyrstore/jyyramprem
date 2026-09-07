const JYYROwnerRoot = () => window.JYYRApp?.getRoot("owner") || document.querySelector("#view-owner") || document;
const icon = (name) => window.icon?.(name) || "";

[
  ["ownerAvatar", "crown"], ["ownerAvatarLarge", "crown"], ["owner-refreshIcon", "refresh"],
  ["owner-logoutIcon", "logout"], ["logoutIconTop", "logout"], ["owner-homeIcon", "home"],
  ["broadcastIcon", "broadcast"], ["trashIcon", "trash"], ["editIcon", "edit"],
  ["messageIcon", "message"], ["bellIcon", "bell"], ["plusIcon", "plus"],
  ["plusIcon2", "plus"], ["shieldIcon", "shield"], ["owner-lockIcon", "lock"],
  ["owner-settingsIcon", "settings"], ["checkIcon", "check"], ["refreshIcon2", "refresh"], ["copyTokenIcon", "copy"], ["refreshTokenHistoryIcon", "refresh"],
  ["tabStatistikIcon", "chart"], ["tabMemberIcon", "users"], ["tabBroadcastIcon", "broadcast"],
  ["tabNotifikasiIcon", "bell"], ["tabTokenIcon", "lock"], ["tabSecurityIcon", "shield"], ["tabSistemIcon", "settings"],
  ["statisticsTitleIcon", "chart"], ["memberTitleIcon", "users"], ["broadcastTitleIcon", "broadcast"],
  ["broadcastHistoryTitleIcon", "receipt"], ["messageTitleIcon", "message"], ["faqTitleIcon", "help"], ["helpTitleIcon", "help"],
  ["portalTokenTitleIcon", "lock"], ["tokenHistoryTitleIcon", "receipt"],
  ["securityTitleIcon", "shield"], ["loginTitleIcon", "lock"], ["systemTitleIcon", "settings"], ["healthTitleIcon", "chart"],
  ["closeMemberIcon", "close"], ["saveMemberIcon", "check"], ["sendMessageIcon", "arrowRight"],
  ["generateTokenIcon", "plus"], ["revokeTokenIcon", "lock"],
].forEach(([id, name]) => {
  const el = JYYROwnerRoot()?.querySelector(`#${id}`);
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
  selectedPortalTokenDuration: "permanent",
  appReleaseEditingId: null,
  appReleaseEditorMode: "create",
  appReleases: [],
  appReleaseSelectedFile: null,
  appReleaseSelectedMetadata: null,
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

const redirectLogin = () => window.JYYRApp?.showView("login");
const redirectHome = () => window.JYYRApp?.showView("home");

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

function portalTokenDurationLabel(mode) {
  return ({
    "15_days": "15 Hari",
    "30_days": "30 Hari",
    permanent: "Permanent",
    legacy: "Legacy",
  })[String(mode || "").trim()] || "Permanent";
}

async function ownerConfirm(message, options = {}) {
  if (typeof window.JYYRNotify?.confirm === "function") {
    return Boolean(await window.JYYRNotify.confirm(message, options));
  }
  return window.confirm(message);
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
  JYYROwnerRoot()?.querySelectorAll("[data-user-name]").forEach((el) => { el.textContent = name; });
  JYYROwnerRoot()?.querySelectorAll("[data-user-email]").forEach((el) => { el.textContent = user?.email || "—"; });
  const registered = JYYROwnerRoot()?.querySelector("#owner-registeredAt");
  if (registered) registered.textContent = user?.created_at ? new Date(user.created_at).toLocaleDateString("id-ID", { dateStyle: "medium" }) : "—";
  const lastLogin = JYYROwnerRoot()?.querySelector("#owner-lastLogin");
  if (lastLogin) lastLogin.textContent = user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "—";
  const securityOwnerName = JYYROwnerRoot()?.querySelector("#securityOwnerName");
  const securityOwnerEmail = JYYROwnerRoot()?.querySelector("#securityOwnerEmail");
  if (securityOwnerName) securityOwnerName.textContent = name;
  if (securityOwnerEmail) securityOwnerEmail.textContent = user?.email || "—";
}

function setupTabs() {
  JYYROwnerRoot()?.querySelectorAll("[data-section]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      JYYROwnerRoot()?.querySelectorAll("[data-section]").forEach((x) => x.classList.remove("active"));
      JYYROwnerRoot()?.querySelectorAll(".owner-section").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      JYYROwnerRoot()?.querySelector(`[data-section="${btn.dataset.section}"]`)?.classList.add("active");
      const session = state.session || await requireSession();
      if (!session) return;
      try {
        if (btn.dataset.section === "notifikasi") {
          await Promise.all([loadConversations(), loadContentAdmin(session)]);
        } else if (btn.dataset.section === "token") {
          await Promise.all([loadPortalTokenStatus(session), loadPortalTokenHistory(session)]);
        } else if (btn.dataset.section === "security") {
          await loadLoginActivity(session);
        } else if (btn.dataset.section === "sistem") {
          await loadMaintenance(session);
        } else if (btn.dataset.section === "app-release") {
          await loadAppReleases(session);
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
  const container = JYYROwnerRoot()?.querySelector(`#${containerId}`);
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
