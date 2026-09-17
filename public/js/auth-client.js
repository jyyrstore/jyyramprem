(function () {
  const STORAGE_KEY = "am_account_portal_session";
  let configPromise;
  let authenticated = false;
  const REQUEST_TIMEOUT_MS = 8000;
  let refreshPromise = null;

  const fetchWithTimeout = window.JYYRNet?.fetchWithTimeout || (async function (resource, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(resource, { ...options, signal: controller.signal }); }
    finally { window.clearTimeout(timer); }
  });

  async function getConfig() {
    if (!configPromise) {
      configPromise = fetchWithTimeout("/api/config", { headers: { Accept: "application/json" }, cache: "no-store" })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok || !data.ok || !data.supabaseUrl || !data.supabasePublishableKey) {
            throw new Error(data.error || "Konfigurasi Supabase tidak lengkap.");
          }
          return { supabaseUrl: data.supabaseUrl.replace(/\/$/, ""), supabasePublishableKey: data.supabasePublishableKey };
        });
    }
    return configPromise;
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeSession(session) {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function normalizeSession(data) {
    if (!data?.access_token) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_in: data.expires_in || 3600,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      token_type: data.token_type || "bearer",
      user: data.user || null,
    };
  }

  async function api(path, options = {}) {
    const config = await getConfig();
    const headers = new Headers(options.headers || {});
    headers.set("apikey", config.supabasePublishableKey);
    headers.set("Content-Type", "application/json");
    const response = await fetchWithTimeout(`${config.supabaseUrl}/auth/v1${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.msg || data.message || data.error_description || data.error || "Autentikasi gagal.");
      error.status = response.status;
      error.code = data.code || data.error_code || "";
      throw error;
    }
    return data;
  }

  async function refreshSession(session) {
    if (!session?.refresh_token) return null;
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      const data = await api("/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      const next = normalizeSession(data);
      writeSession(next);
      return next;
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  function adoptRecoverySessionFromUrl() {
    try {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams((url.hash || '').replace(/^#/, ''));
      const accessToken = hash.get('access_token') || url.searchParams.get('access_token');
      const refreshToken = hash.get('refresh_token') || url.searchParams.get('refresh_token');
      if (!accessToken || !refreshToken) return null;

      const expiresIn = Number(hash.get('expires_in') || url.searchParams.get('expires_in') || 3600);
      const tokenType = hash.get('token_type') || url.searchParams.get('token_type') || 'bearer';
      const session = normalizeSession({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
        token_type: tokenType,
      });
      if (!session) return null;

      writeSession(session);
      // Never leave access/refresh tokens in the visible URL or browser history.
      url.hash = '';
      url.searchParams.delete('access_token');
      url.searchParams.delete('refresh_token');
      url.searchParams.delete('expires_in');
      url.searchParams.delete('token_type');
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + url.hash);
      return session;
    } catch { return null; }
  }

  function consumeOAuthErrorFromUrl() {
    try {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
      const errorCode = url.searchParams.get("auth_error") || hash.get("error_code") || url.searchParams.get("error_code");
      const error = hash.get("error") || url.searchParams.get("error");
      if (!errorCode && !error) return null;

      const cancelled = error === "access_denied" || errorCode === "user_cancelled_login";
      hash.delete("error");
      hash.delete("error_code");
      hash.delete("error_description");
      url.searchParams.delete("auth_error");
      url.searchParams.delete("error");
      url.searchParams.delete("error_code");
      url.searchParams.delete("error_description");
      const cleanHash = hash.toString();
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : "") + (cleanHash ? `#${cleanHash}` : ""));
      return { code: errorCode || error || "google_oauth_failed", cancelled };
    } catch {
      return null;
    }
  }

  function signInWithGoogle() {
  const nativeApp =
    window.__JYYR_NATIVE_APP__ === true ||
    window.AndroidApp?.isNativeApp?.() === true;

  if (nativeApp) {
    window.location.assign(
      "https://www.jyyramprem.my.id/api/auth/google?client=android"
    );
    return;
  }

  window.location.assign("/api/auth/google");
}

  async function getSession() {
    // OAuth/recovery redirects must take precedence over any stale stored session.
    // Otherwise a previous session can mask the fresh tokens returned by Google.
    let session = adoptRecoverySessionFromUrl() || readSession();
    if (!session?.access_token) { authenticated = false; window.__JYYR_AUTHENTICATED__ = false; return null; }
    const expiresAt = Number(session.expires_at || 0);
    if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 30) {
      try { session = await refreshSession(session); } catch { writeSession(null); authenticated = false; window.__JYYR_AUTHENTICATED__ = false; return null; }
    }
    authenticated = true;
    window.__JYYR_AUTHENTICATED__ = true;
    return session;
  }

  async function signIn(email, password) {
    const data = await api("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    const session = normalizeSession(data);
    writeSession(session);
    authenticated = Boolean(session?.access_token);
    window.__JYYR_AUTHENTICATED__ = authenticated;
    return { session, user: session?.user || null };
  }

  async function signUp(email, password, dataOptions = {}) {
    const response = await fetchWithTimeout("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password, data: dataOptions }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.message || "Registrasi gagal.");
      error.status = response.status;
      error.code = data.code || "";
      error.retryAfter = Number(data.retryAfter || 0);
      throw error;
    }
    return data;
  }

  async function resendSignupCode(email) {
    const response = await fetchWithTimeout("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.message || "Tidak dapat mengirim ulang code.");
      error.status = response.status;
      error.code = data.code || "";
      error.retryAfter = Number(data.retryAfter || 0);
      throw error;
    }
    return data;
  }

  async function verifyOtp(email, token, password) {
    const response = await fetchWithTimeout("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, code: token, ...(password ? { password } : {}) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.message || "Code verifikasi tidak valid.");
      error.status = response.status;
      error.code = data.code || "";
      error.retryAfter = Number(data.retryAfter || 0);
      throw error;
    }
    // Supabase Auth returns the session inside `data.session` for verifyOtp.
    // Accept both the nested Supabase shape and a legacy top-level session so
    // successful email verification immediately establishes the browser auth session.
    const session = normalizeSession(data?.session || data);
    if (session) writeSession(session);
    return { session, user: data.user || data?.session?.user || session?.user || null };
  }

  async function signOut() {
    const session = readSession();
    try {
      if (session?.access_token) {
        const config = await getConfig();
        await fetchWithTimeout(`${config.supabaseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${session.access_token}` },
        });
      }
    } finally { writeSession(null); authenticated = false; window.__JYYR_AUTHENTICATED__ = false; }
  }

  async function deleteAccount(confirmationEmail) {
    const session = await getSession();

    if (!session?.access_token) {
      throw new Error("Login diperlukan.");
    }

    const response = await fetchWithTimeout("/api/auth/account", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ confirmationEmail }),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    return { response, data };
  }

  async function resetPassword(email, redirectTo) {
    return api("/recover", { method: "POST", body: JSON.stringify({ email, redirect_to: redirectTo }) });
  }

  async function portalRequest(path, options = {}) {
    const session = await getSession();
    if (!session?.access_token) throw new Error("Login diperlukan.");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${session.access_token}`);
    headers.set("Accept", "application/json");
    if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetchWithTimeout(path, { ...options, headers, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function bootstrapAccount() {
    return portalRequest("/api/auth/bootstrap", { method: "POST" });
  }

  async function getPortalAccess() {
    return portalRequest("/api/access/status");
  }

  async function contactOwnerForPortalToken() {
    return portalRequest("/api/access/contact-owner");
  }

  async function getTokenCenterLink() {
    return portalRequest("/api/access/token-center-link", { method: "POST" });
  }

  async function verifyPortalToken(token) {
    return portalRequest("/api/access/verify", { method: "POST", body: JSON.stringify({ token }) });
  }

  async function fetchSupabaseUser(accessToken) {
    const config = await getConfig();
    const response = await fetchWithTimeout(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.id) {
      const error = new Error(data?.message || data?.error_description || "Sesi Supabase tidak valid.");
      error.status = response.status;
      error.code = data?.code || "invalid_session";
      throw error;
    }
    return data;
  }

  async function adoptNativeOAuthSession(candidate) {
    let session = normalizeSession(candidate);
    if (!session?.access_token || !session?.refresh_token) {
      throw Object.assign(new Error("Credential OAuth tidak lengkap."), { code: "invalid_oauth_credential" });
    }

    try {
      session.user = await fetchSupabaseUser(session.access_token);
    } catch (firstError) {
      if (!session.refresh_token) {
        writeSession(null);
        authenticated = false;
        throw firstError;
      }
      try {
        const refreshed = await refreshSession(session);
        if (!refreshed?.access_token) throw firstError;
        session = refreshed;
        session.user = await fetchSupabaseUser(session.access_token);
      } catch (refreshError) {
        writeSession(null);
        authenticated = false;
        throw refreshError;
      }
    }

    writeSession(session);
    authenticated = true;
    window.__JYYR_AUTHENTICATED__ = true;
    window.dispatchEvent(new CustomEvent("jyyr:native-authenticated"));
    return session;
  }

  function handleNativeOAuthError(code, state) {
    authenticated = false;
    window.__JYYR_AUTHENTICATED__ = false;
    window.__JYYR_NATIVE_OAUTH_ERROR__ = { code: String(code || "google_oauth_failed"), state: state || null };
    window.dispatchEvent(new CustomEvent("jyyr:native-oauth-error"));
  }

  async function getUser() {
    const session = await getSession();
    if (!session?.access_token) { authenticated = false; return null; }
    try {
      const user = await fetchSupabaseUser(session.access_token);
      session.user = user;
      writeSession(session);
      authenticated = true;
      window.__JYYR_AUTHENTICATED__ = true;
      return user;
    } catch {
      writeSession(null);
      authenticated = false;
      window.__JYYR_AUTHENTICATED__ = false;
      return null;
    }
  }

  function getAuthState() {
    return { authenticated, session: readSession() };
  }

  window.AMAuth = { getConfig, getSession, signIn, signInWithGoogle, consumeOAuthErrorFromUrl, signUp, resendSignupCode, verifyOtp, signOut, resetPassword, deleteAccount, getUser, adoptNativeOAuthSession, handleNativeOAuthError, getAuthState, bootstrapAccount, getPortalAccess, contactOwnerForPortalToken, getTokenCenterLink, verifyPortalToken };
})();
