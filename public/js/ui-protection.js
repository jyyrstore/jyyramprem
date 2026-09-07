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
  let watchdogListenersBound = false;

  function currentPage() {
    return String(document.body?.dataset?.page || '').trim().toLowerCase();
  }

  function redirectToTokenGate() {
    window.JYYRApp?.showView('login', { tokenRequired: true });
  }

  async function enforcePortalAccess() {
    if (!protectedPages.has(currentPage()) || accessCheckRunning) return;
    accessCheckRunning = true;
    try {
      if (!window.AMAuth?.getSession || !window.AMAuth?.getPortalAccess) return;
      const session = await window.AMAuth.getSession();
      if (!session) {
        window.JYYRApp?.showView('login');
        return;
      }
      const gate = await window.AMAuth.getPortalAccess();
      if (!gate?.response) return; // Network failure: do not falsely sign out.
      if (gate.response.status === 401) {
        await window.AMAuth.signOut().catch(() => {});
        window.JYYRApp?.showView('login');
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
    if (!protectedPages.has(currentPage())) return;
    enforcePortalAccess();
    // The server remains authoritative; the timer is only a client-side detection aid.
    if (!watchdogListenersBound) {
      watchdogListenersBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) enforcePortalAccess();
      });
      window.addEventListener('pageshow', () => enforcePortalAccess());
      window.addEventListener('focus', () => enforcePortalAccess());
    }
    if (watchdogTimer) window.clearTimeout(watchdogTimer);
    watchdogTimer = window.setTimeout(enforcePortalAccess, 30000);
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

  window.addEventListener('jyyr:viewchange', () => startPortalAccessWatchdog());
  startPortalAccessWatchdog();
})();
