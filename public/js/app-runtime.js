/* ===================================================== */
/* GLOBAL APPLICATION STATE                              */
/* ===================================================== */
(() => {
  "use strict";

  const VIEWS = ["login", "home", "dashboard", "setting", "owner", "app", "help", "reset-password"];
  const roots = new Map();
  const initializers = new Map();
  const initialized = new Set();
  let currentView = null;
  let navigationBound = false;
  let transitionSerial = 0;

  function getRoot(view) { return roots.get(view) || null; }
  function register(view, initializer) { initializers.set(view, initializer); }

  window.JYYRRegisterView = register;

  /* ===================================================== */
  /* GLOBAL UTILITIES                                      */
  /* ===================================================== */
  function canonicalizeUrl() {
    if (location.pathname !== "/" || location.search || location.hash) {
      history.replaceState({ ...(history.state || {}), view: currentView }, document.title, "/");
    }
  }

  function tokenRequired() {
    return window.sessionStorage?.getItem("jyyr:token-required") === "1";
  }

  function bindInternalNavigation() {
    if (navigationBound) return;
    navigationBound = true;
    document.addEventListener("click", (event) => {
      const anchor = event.target?.closest?.("a[data-app-nav]");
      if (!anchor) return;
      event.preventDefault();
      const view = anchor.dataset.appNav;
      const options = {};
      if (anchor.dataset.appScroll) options.scroll = anchor.dataset.appScroll;
      showView(view, options).catch((error) => console.error("[APP NAV]", error));
    });
  }

  async function initializeView(view, options = {}) {
    const init = initializers.get(view);
    const root = roots.get(view);
    if (!init || !root || initialized.has(view)) return;
    initialized.add(view);
    try {
      await init(root, options);
    } catch (error) {
      initialized.delete(view);
      throw error;
    }
    if (view === "login" && (options.tokenRequired || tokenRequired())) {
      window.JYYRAuthView?.showPortalTokenGate?.();
      try { sessionStorage.removeItem("jyyr:token-required"); } catch {}
    }
  }

  async function showView(view, options = {}) {
    if (!VIEWS.includes(view)) view = "login";
    const serial = ++transitionSerial;
    currentView = view;

    for (const name of VIEWS) {
      const root = roots.get(name);
      if (!root) continue;
      const active = name === view;
      root.hidden = !active;
      root.setAttribute("aria-hidden", String(!active));
      root.dataset.active = active ? "true" : "false";
    }

    document.body.dataset.page = view;
    document.body.classList.toggle("auth-page", view === "login" || view === "reset-password");
    document.body.classList.remove("access-modal-open");

    if (!options.fromHistory && history.state?.view !== view) {
      history.pushState({ view }, document.title, "/");
    } else {
      canonicalizeUrl();
    }

    const root = roots.get(view);
    window.JYYR?.renderShared?.(root, view);
    if (["home", "dashboard", "setting", "owner"].includes(view)) {
      await window.JYYR?.init?.(root, view);
    }
    if (view === "owner" && window.JYYROwner?.loadPage) {
      try { await window.JYYROwner.loadPage(); } catch (error) { console.error("[OWNER LOAD ERROR]", error); }
    }
    await initializeView(view, options);

    if (serial !== transitionSerial) return currentView;
    const scrollTarget = options.scroll;
    if (scrollTarget) {
      requestAnimationFrame(() => {
        const target = roots.get(view)?.querySelector(`#${CSS.escape(String(scrollTarget))}`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    window.dispatchEvent(new CustomEvent("jyyr:viewchange", { detail: { view, currentView } }));
    return view;
  }

  async function determineInitialView() {
    const raw = `${location.hash || ""}&${location.search || ""}`;
    if (/access_token=|refresh_token=|type=recovery/.test(raw)) return "reset-password";
    if (location.search.includes("token=required") || tokenRequired()) return "login";
    const session = await window.AMAuth?.getSession?.().catch(() => null);
    return session?.access_token ? "home" : "login";
  }

  window.addEventListener("popstate", () => {
    const view = history.state?.view;
    if (VIEWS.includes(view)) showView(view, { fromHistory: true }).catch((error) => console.error("[APP HISTORY]", error));
    else determineInitialView().then((next) => showView(next, { fromHistory: true })).catch((error) => console.error("[APP HISTORY]", error));
  });

  window.JYYRApp = {
    get currentView() { return currentView; },
    getRoot,
    showView,
    register
  };

  window.addEventListener("DOMContentLoaded", async () => {
    document.querySelectorAll(".app-view[data-view]").forEach((root) => roots.set(root.dataset.view, root));
    bindInternalNavigation();
    const first = await determineInitialView();
    history.replaceState({ ...(history.state || {}), view: first }, document.title, "/");
    try {
      await showView(first, { fromHistory: true });
    } catch (error) {
      console.error("[APP BOOT]", error);
    }
  });
})();

/* ===================================================== */
/* VIEW MANAGER                                          */
/* ===================================================== */
