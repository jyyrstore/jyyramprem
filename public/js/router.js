(() => {
  "use strict";

  const VIEW_META = {
    login: { css: ["/css/login.css?v=20260827-wordmark-v6"], scripts: ["/js/icons.js", "/js/notifications.js", "/js/auth.js?v=20260827-wordmark-v6"], title: "Jyy'r Amprem • Login", auth: false },
    home: { css: ["/css/home.css"], scripts: ["/js/icons.js", "/js/ui-icons-assets.js", "/js/nav.js", "/js/notifications.js", "/js/home.js"], title: "Jyy'R Amprem • Home", auth: true },
    dashboard: { css: ["/css/dashboard.css"], scripts: ["/js/icons.js", "/js/ui-icons-assets.js", "/js/nav.js", "/js/notifications.js", "/js/dashboard.js"], title: "Jyy'R Amprem • Dashboard", auth: true },
    setting: { css: ["/css/setting.css"], scripts: ["/js/icons.js", "/js/ui-icons-assets.js", "/js/nav.js", "/js/notifications.js", "/js/setting.js?v=20260904-token-v4"], title: "Jyy'R Amprem • Account", auth: true },
    owner: { css: ["/css/owner.css"], scripts: ["/js/icons.js", "/js/ui-icons-assets.js", "/js/nav.js", "/js/notifications.js", "/js/apk-metadata.js", "/js/owner/core.js?v=20260910-token-contract-v2", "/js/owner/members.js", "/js/owner/portal-token.js?v=20260910-token-contract-v2", "/js/owner/dashboard.js", "/js/owner/broadcasts.js", "/js/owner/messaging.js", "/js/owner/content.js", "/js/owner/events.js", "/js/owner/releases.js", "/js/owner.js?v=20260910-token-contract-v2"], title: "Jyy'R Amprem • Owner", auth: true },
    app: { css: ["/css/app.css"], scripts: ["/js/app.js"], title: "Jyy'R Amprem • Download", auth: false },
    help: { css: ["/css/help.css"], scripts: ["/js/help.js"], title: "Pusat Bantuan • Jyy'R Amprem", auth: false },
    maintenance: { css: ["/css/maintenance.css"], scripts: ["/js/maintenance.js"], title: "Maintenance • Jyy'R Amprem", auth: false },
    "reset-password": { css: ["/css/reset-password.css"], scripts: ["/js/icons.js", "/js/ui-icons-assets.js", "/js/notifications.js", "/js/reset-password.js"], title: "Reset Password • Jyy'R Amprem", auth: false },
  };

  const views = new Map([...document.querySelectorAll(".app-view[data-view]")].map((el) => [el.dataset.view, el]));
  // CSP blocks inline event handlers; keep the previous resilient image fallback
  // using one delegated listener for the shared SPA document.
  document.addEventListener("error", (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.dataset.hideOnError === "true") target.hidden = true;
  }, true);

  const loadedScripts = new Set();
  let activeView = null;
  let activeStyleLinks = [];
  let navigationSerial = 0;

  const REQUEST_TIMEOUT_MS = 7000;
  const BOOT_TIMEOUT_MS = 12000;

  function withTimeout(promise, timeoutMs, label) {
    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : REQUEST_TIMEOUT_MS;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error(`${label} timeout`)), timeout);
      }),
    ]);
  }

  function completeBootLoader() {
    const loader = document.getElementById("app-loading");
    if (!loader) return;
    loader.setAttribute("aria-busy", "false");
    loader.classList.add("is-complete");
    window.setTimeout(() => loader.remove(), 180);
  }

  function showBootFallback() {
    const target = activeView && views.get(activeView);
    if (target?.isConnected && !target.hidden && target.dataset.booting !== "1") return Promise.resolve(true);
    if (target?.isConnected) { target.hidden = true; target.remove(); }
    activeView = null;
    return showView("login", { replaceUrl: true, updateUrl: true }).catch((error) => {
      console.error("[JYYR ROUTER] Boot fallback failed", error);
      return false;
    });
  }

  const ROUTES = {
    home: "/",
    dashboard: "/dashboard",
    setting: "/setting",
    owner: "/owner",
    app: "/app",
    help: "/help",
    maintenance: "/maintenance",
    login: "/login",
    "reset-password": "/reset-password",
  };
  const VIEW_BY_PATH = new Map(Object.entries(ROUTES).map(([view, route]) => [route, view]));

  function readViewFromUrl() {
    try {
      const url = new URL(window.location.href);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      return normalizeView(VIEW_BY_PATH.get(pathname) || null);
    } catch {
      return null;
    }
  }

  function syncViewUrl(name, { replace = false, section = null } = {}) {
    try {
      const url = new URL(window.location.href);
      url.pathname = ROUTES[name] || "/";
      const nextSearch = new URLSearchParams();
      if (section) nextSearch.set("section", section);
      url.search = nextSearch.toString();
      const next = `${url.pathname}${url.search}${url.hash}`;
      const method = replace ? "replaceState" : "pushState";
      window.history[method]({}, VIEW_META[name].title, next);
    } catch {}
  }

  function normalizeView(value) {
    const name = String(value || "").trim().toLowerCase();
    return VIEW_META[name] && views.has(name) ? name : null;
  }

  function legacyContextFromUrl() {
    try {
      const url = new URL(window.location.href);
      const username = String(url.searchParams.get("username") || "").trim();
      const tokenId = String(url.searchParams.get("token_id") || "").trim();
      if (!username && !tokenId) return null;
      if (username) sessionStorage.setItem("jyyr:login_username", username);
      if (/^[0-9a-f-]{36}$/i.test(tokenId)) sessionStorage.setItem("jyyr:selected_token_id", tokenId);
      // Legacy handoff URLs are compatibility input, never the canonical application URL.
      const canonical = ROUTES[readViewFromUrl() || "home"];
      const clean = new URL(canonical, window.location.origin);
      window.history.replaceState({}, document.title, clean.pathname);
      return { username, tokenId };
    } catch {
      return null;
    }
  }

  function isRecoveryUrl() {
    try {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
      const type = hash.get("type") || url.searchParams.get("type") || "";
      const hasSessionTokens = Boolean(
        (hash.get("access_token") && hash.get("refresh_token")) ||
        (url.searchParams.get("access_token") && url.searchParams.get("refresh_token"))
      );

      // OAuth sign-in (including Google) also returns access/refresh tokens.
      // Only an explicit Supabase `type=recovery` callback may enter the
      // reset-password view. This prevents Google login from being mistaken
      // for password recovery.
      return hasSessionTokens && type === "recovery";
    } catch {
      return false;
    }
  }

  function isOAuthCallbackUrl() {
    try {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
      const type = hash.get("type") || url.searchParams.get("type") || "";
      const hasSessionTokens = Boolean(
        (hash.get("access_token") && hash.get("refresh_token")) ||
        (url.searchParams.get("access_token") && url.searchParams.get("refresh_token"))
      );

      // Google OAuth memakai access/refresh token seperti session Supabase.
      // Recovery tetap ditentukan secara eksklusif oleh type=recovery.
      return hasSessionTokens && type !== "recovery";
    } catch {
      return false;
    }
  }

  function updateBodyState(name) {
    document.body.dataset.page = name;
    document.body.classList.toggle("auth-page", name === "login" || name === "reset-password");
    document.title = VIEW_META[name].title;
  }

  async function loadCss(name) {
    for (const href of VIEW_META[name].css) {
      if (document.querySelector(`link[data-jyyr-view-style="${CSS.escape(href)}"]`)) continue;
      await withTimeout(new Promise((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.jyyrViewStyle = href;
        link.onload = resolve;
        link.onerror = resolve;
        document.head.appendChild(link);
        activeStyleLinks.push(link);
      }), REQUEST_TIMEOUT_MS + 1000, `view css ${name}`);
    }
  }

  async function loadScript(src) {
    const key = src.split("?")[0];
    if (loadedScripts.has(key)) return;
    await withTimeout(new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      // Page-specific scripts must be module-scoped because all views now share
      // one Document. Owner feature modules intentionally remain classic scripts
      // because they share an existing lexical runtime between modules.
      const baseSrc = key;
      if (!baseSrc.startsWith("/js/owner/") && baseSrc !== "/js/owner.js" && baseSrc !== "/js/nav.js" && baseSrc !== "/js/ui-protection.js" && baseSrc !== "/js/icons.js" && baseSrc !== "/js/ui-icons-assets.js" && baseSrc !== "/js/notifications.js" && baseSrc !== "/js/auth-client.js") {
        script.type = "module";
      }
      script.dataset.jyyrLoadedScript = key;
      script.onload = resolve;
      script.onerror = (event) => {
        console.error("[JYYR ROUTER] Script load failed", src, event);
        resolve();
      };
      document.body.appendChild(script);
      loadedScripts.add(key);
    }), REQUEST_TIMEOUT_MS + 1000, `script ${src}`);
  }

  async function loadViewScripts(name) {
    for (const src of VIEW_META[name].scripts) await loadScript(src);
    // nav.js is intentionally loaded once but needs an explicit boot because this SPA inserts views after DOMContentLoaded.
    if (VIEW_META[name].scripts.some((src) => src.split("?")[0] === "/js/nav.js")) {
      window.JYYR?.renderShared?.();
      await withTimeout(window.JYYR?.init?.(), REQUEST_TIMEOUT_MS + 2000, `view init ${name}`);
    }
  }

  function detachInactiveViews() {
    for (const [name, section] of views) {
      if (name !== activeView && section.isConnected) {
        section.hidden = true;
        section.remove();
      }
    }
  }

  async function showView(viewName, options = {}) {
    const name = normalizeView(viewName);
    if (!name) return false;
    const serial = ++navigationSerial;
    const next = views.get(name);

    legacyContextFromUrl();
    if (name !== "maintenance" && name !== "login" && name !== "reset-password") {
      console.time("[JYYR] getSession");
      const session = await withTimeout(window.AMAuth.getSession(), REQUEST_TIMEOUT_MS, "view session").catch(() => null);
      console.timeEnd("[JYYR] getSession");
      console.time("[JYYR] maintenance");
      const maintenance = await withTimeout(getMaintenanceState(session), REQUEST_TIMEOUT_MS + 1000, "view maintenance");
      console.timeEnd("[JYYR] maintenance");
      if (session?.access_token && maintenance.data?.maintenance_enabled === true && maintenance.data?.owner !== true) {
        return showView("maintenance", { updateUrl: true, replaceUrl: true });
      }
    }
    if (options.updateUrl) {
      syncViewUrl(name, { replace: options.replaceUrl === true, section: options.section || null });
    }

    if (activeView === name && next.isConnected) {
      if (options.tokenRequired) window.JYYRAuthView?.showPortalTokenGate?.();
      if (options.section) next.dataset.section = options.section;
      if (options.focus) document.getElementById(options.focus)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    }

    if (activeView) {
      const current = views.get(activeView);
      if (current) {
        current.hidden = true;
        current.remove();
      }
    }

    detachInactiveViews();
    const template = next.querySelector(":scope > template");
    if (template && next.dataset.materialized !== "1") {
      next.appendChild(template.content.cloneNode(true));
      next.dataset.materialized = "1";
    }
    if (options.section) next.dataset.section = options.section; else delete next.dataset.section;
    next.hidden = true;
    next.dataset.booting = "1";
    document.querySelector("#app-root")?.appendChild(next);
    activeView = name;
    updateBodyState(name);

    activeStyleLinks.forEach((link) => link.remove());
    activeStyleLinks = [];
    console.time(`[JYYR] loadCss:${name}`);
    await withTimeout(loadCss(name), REQUEST_TIMEOUT_MS + 1000, `view css ${name}`);
    console.timeEnd(`[JYYR] loadCss:${name}`);
    if (serial !== navigationSerial) return false;
    console.time(`[JYYR] scripts:${name}`);
    await withTimeout(loadViewScripts(name), REQUEST_TIMEOUT_MS + 2000, `view scripts ${name}`);
    console.timeEnd(`[JYYR] scripts:${name}`);
    window.JYYRUIProtection?.start?.();
    window.JYYRUIProtection?.refresh?.();
    if (serial !== navigationSerial) return false;
    next.hidden = false;
    delete next.dataset.booting;
    completeBootLoader();

    if (options.tokenRequired) window.JYYRAuthView?.showPortalTokenGate?.();
    if (options.focus) requestAnimationFrame(() => document.getElementById(options.focus)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    if (name === "help" && options.section) next.dataset.section = options.section;
    return true;
  }

  function navigate(viewName, options = {}) {
    return showView(viewName, { updateUrl: true, ...options }).catch((error) => {
      console.error("[JYYR ROUTER] Navigation failed", { viewName, error });
      return false;
    });
  }

  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("[data-jyyr-view]");
    if (!link) return;
    if (link.target === "_blank" || event.defaultPrevented) return;
    const view = link.dataset.jyyrView;
    if (!normalizeView(view)) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(view, {
      section: link.dataset.jyyrSection || undefined,
      focus: link.dataset.jyyrFocus || undefined,
      tokenRequired: link.dataset.jyyrTokenRequired === "true",
    });
  }, true);

  const protectionScript = document.createElement("script");
  protectionScript.src = "/js/ui-protection.js";
  protectionScript.async = false;
  document.body.appendChild(protectionScript);
  loadedScripts.add("/js/ui-protection.js");

  window.JYYRApp = { showView, navigate, get activeView() { return activeView; }, getViewElement: (name) => views.get(normalizeView(name)) || null };

  async function getMaintenanceState(session) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = { Accept: "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const response = await fetch("/api/maintenance", { headers, cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch {
      return { response: null, data: null };
    } finally {
      window.clearTimeout(timer);
    }
  }

  window.JYYRAppMaintenance = { getMaintenanceState };

  window.addEventListener("popstate", () => {
    const requested = readViewFromUrl();
    if (requested) navigate(requested, { replaceUrl: true, fromHistory: true });
    else navigate("home", { replaceUrl: true, fromHistory: true });
  });

  (async () => {
    const bootDeadline = window.setTimeout(async () => {
      if (activeView) return;
      console.warn("[JYYR ROUTER] Boot watchdog fired");
      await showBootFallback();
      completeBootLoader();
    }, BOOT_TIMEOUT_MS);

    try {
    legacyContextFromUrl();
    const recovery = isRecoveryUrl();
    const oauthCallback = isOAuthCallbackUrl();
    const session = await withTimeout(window.AMAuth.getSession(), REQUEST_TIMEOUT_MS, "startup session").catch(() => null);
    const context = sessionStorage.getItem("jyyr:login_username") || sessionStorage.getItem("jyyr:selected_token_id");

    if (recovery) {
      await withTimeout(showView("reset-password", { replaceUrl: true }), BOOT_TIMEOUT_MS, "recovery view");
      return;
    }

    // Fresh Google OAuth wajib melewati Login View agar auth.js
    // menjalankan Token Gate sebelum user diperbolehkan masuk Home.
    if (oauthCallback && session?.access_token) {
      await withTimeout(showView("login", { replaceUrl: true }), BOOT_TIMEOUT_MS, "oauth view");
      return;
    }

    if (context && !session) {
      await withTimeout(showView("login", { replaceUrl: true }), BOOT_TIMEOUT_MS, "context login view");
      return;
    }

    const requestedView = readViewFromUrl();
    const requestedName = requestedView || (session?.access_token ? "home" : "login");
    const maintenance = await withTimeout(getMaintenanceState(session), REQUEST_TIMEOUT_MS + 1000, "startup maintenance");

    if (session?.access_token && maintenance.data?.maintenance_enabled === true && maintenance.data?.owner !== true) {
      await withTimeout(showView("maintenance", { replaceUrl: true }), BOOT_TIMEOUT_MS, "maintenance view");
      return;
    }

    await withTimeout(showView(requestedName, { replaceUrl: true }), BOOT_TIMEOUT_MS, `${requestedName} view`);
    } catch (error) {
      console.error("[JYYR ROUTER] Startup failed", error);
      await showBootFallback();
    } finally {
      window.clearTimeout(bootDeadline);
      completeBootLoader();
    }
  })();
})();
