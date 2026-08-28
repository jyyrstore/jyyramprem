const ALLOWED_MAGIC_HOSTS = new Set([
  "alightcreative.com",
  "alight-creative.firebaseapp.com",
]);

function isAllowedHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return [...ALLOWED_MAGIC_HOSTS].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );
}

export function normalizeMagicLink(value) {
  if (typeof value !== "string" || !value.trim()) {
    return { value: null, valid: false, reason: "MISSING" };
  }

  const raw = value.trim();

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      return { value: null, valid: false, reason: "UNSUPPORTED_PROTOCOL" };
    }
    if (!isAllowedHost(url.hostname)) {
      return { value: null, valid: false, reason: "UNEXPECTED_HOST" };
    }

    const path = url.pathname.replace(/\/+$/, "");
    const validPath =
      /\/auth_action$/i.test(path) ||
      /\/__\/auth\/links$/i.test(path);

    if (!validPath) {
      return { value: null, valid: false, reason: "UNEXPECTED_PATH" };
    }

    return { value: url.toString(), valid: true, reason: null };
  } catch {
    return { value: null, valid: false, reason: "INVALID_URL" };
  }
}

export function pickMagicLink(...values) {
  for (const value of values) {
    const result = normalizeMagicLink(value);
    if (result.valid) return result;
  }
  return { value: null, valid: false, reason: "NO_VALID_MAGIC_LINK" };
}
