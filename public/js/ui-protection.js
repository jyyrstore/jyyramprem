/*
 * JYY'R AMPREM — UI interaction protection
 * Also enforces the member portal access boundary on protected portal pages.
 */
(() => {
  "use strict";

  const protectedMedia = "img,video,svg,canvas,.asset-ui-icon,.ui-icon";
  const protectedPages = new Set(["home", "dashboard", "setting"]);
  let accessCheckRunning = false;
  let watchdogTimer = null;
  let maintenanceTimer = null;
  let watchdogStarted = false;
  let maintenanceCheckRunning = false;

  function currentPage() {
    return String(document.body?.dataset?.page || '').trim().toLowerCase();
  }

  function redirectToTokenGate() {
    window.JYYRApp?.navigate("login", { tokenRequired: true });
  }

  async function enforceMaintenanceMode() {
    if (maintenanceCheckRunning) return;
    maintenanceCheckRunning = true;
    try {
      const session = await window.AMAuth?.getSession?.().catch(() => null);
      if (!session?.access_token) return;
      const response = await fetch("/api/maintenance", {
        headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (data?.maintenance_enabled === true && data?.owner !== true && currentPage() !== "maintenance") {
        window.JYYRApp?.navigate("maintenance", { replaceUrl: true });
      }
    } catch {
      // Availability failure must not falsely revoke the user's session.
    } finally {
      maintenanceCheckRunning = false;
    }
  }

  async function enforcePortalAccess() {
    if (!protectedPages.has(currentPage()) || accessCheckRunning) return;
    accessCheckRunning = true;
    try {
      if (!window.AMAuth?.getSession || !window.AMAuth?.getPortalAccess) return;
      const session = await window.AMAuth.getSession();
      if (!session) {
        window.JYYRApp?.navigate("login");
        return;
      }
      const gate = await window.AMAuth.getPortalAccess();
      if (!gate?.response) return; // Network failure: do not falsely sign out.
      if (gate.response.status === 401) {
        await window.AMAuth.signOut().catch(() => {});
        window.JYYRApp?.navigate("login");
        return;
      }
      if (gate.response.status === 403) {
        await window.AMAuth.signOut().catch(() => {});
        redirectToTokenGate();
        return;
      }
      if (gate.response.ok && gate.data?.access !== true && gate.data?.owner !== true) {
        await window.AMAuth.signOut().catch(() => {});
        redirectToTokenGate();
        return;
      }
      if (watchdogTimer) window.clearTimeout(watchdogTimer);
      const expiresAt = Date.parse(gate.data?.tokenLifetime?.access_expires_at || '');
      const delay = Number.isFinite(expiresAt)
        ? Math.max(1000, Math.min(30000, expiresAt - Date.now() + 250))
        : 30000;
      watchdogTimer = window.setTimeout(enforcePortalAccess, delay);
    } finally {
      accessCheckRunning = false;
    }
  }

  function startPortalAccessWatchdog() {
    if (watchdogStarted) return;
    if (!protectedPages.has(currentPage())) return;
    watchdogStarted = true;
    enforcePortalAccess();
    enforceMaintenanceMode();
    // The server remains authoritative; timers are only client-side detection aids.
    window.setTimeout(enforcePortalAccess, 30000);
    maintenanceTimer = window.setInterval(enforceMaintenanceMode, 15000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { enforcePortalAccess(); enforceMaintenanceMode(); }
    });
    window.addEventListener('pageshow', () => { enforcePortalAccess(); enforceMaintenanceMode(); });
    window.addEventListener('focus', () => { enforcePortalAccess(); enforceMaintenanceMode(); });
  }

  document.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Element && event.target.closest(protectedMedia)) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("dragstart", (event) => {
    if (event.target instanceof Element && event.target.closest(protectedMedia)) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("selectstart", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("input,textarea,select,[contenteditable='true']") ||
        target.closest("input,textarea,select,[contenteditable='true']")) {
      return;
    }
    if (target.closest(protectedMedia)) {
      event.preventDefault();
    }
  }, { passive: false });

  window.JYYRUIProtection = { refresh: enforcePortalAccess, start: startPortalAccessWatchdog };
  startPortalAccessWatchdog();
})();
