const STAGES = new Set([
  "request_start",
  "response_received",
  "provider_contract",
  "completed",
  "delivery_update",
  "failed",
]);

const OUTCOMES = new Set([
  "ok",
  "failed",
  "invalid",
  "timeout",
  "mismatch",
  "not_available",
]);

const SECRET_KEYS = new Set([
  "token", "access_token", "refresh_token", "id_token", "password",
  "apiKey", "api_key", "authorization", "cookie", "set-cookie",
]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function safeString(value, max = 256) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function safeInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function safeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function rejectSecretKeys(value, path = "") {
  if (!isPlainObject(value)) return null;
  const found = [];
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEYS.has(key) || /^(?:raw_)?(?:token|password|secret|authorization|cookie|apikey)$/i.test(key)) {
      found.push(path ? `${path}.${key}` : key);
      continue;
    }
    if (isPlainObject(nested)) {
      found.push(...rejectSecretKeys(nested, path ? `${path}.${key}` : key));
    }
  }
  return found;
}

export function normalizeProviderDiagnosticEvent(input) {
  if (!isPlainObject(input)) throw new Error("EVENT_OBJECT_REQUIRED");

  const secretFields = rejectSecretKeys(input);
  if (secretFields?.length) {
    const error = new Error("SECRET_FIELDS_FORBIDDEN");
    error.details = secretFields.slice(0, 20);
    throw error;
  }

  const stage = safeString(input.stage, 64);
  if (!STAGES.has(stage)) throw new Error("INVALID_STAGE");

  const outcome = input.outcome == null ? null : safeString(input.outcome, 32);
  if (outcome && !OUTCOMES.has(outcome)) throw new Error("INVALID_OUTCOME");

  const provider = isPlainObject(input.provider) ? input.provider : {};

  return {
    schemaVersion: "1.0",
    eventId: safeString(input.eventId, 128),
    requestId: safeString(input.requestId, 128),
    stage,
    outcome,
    elapsedMs: safeInteger(input.elapsedMs, 0, 24 * 60 * 60 * 1000),
    provider: {
      host: safeString(provider.host, 253),
      path: safeString(provider.path, 512),
      httpStatus: safeInteger(provider.httpStatus, 100, 599),
      httpOk: safeBoolean(provider.httpOk),
      contractValid: safeBoolean(provider.contractValid),
      contractErrors: Array.isArray(provider.contractErrors)
        ? provider.contractErrors.filter((x) => typeof x === "string").slice(0, 20)
        : [],
    },
    timestamp: new Date().toISOString(),
  };
}

export function providerDiagnosticPublicError(error) {
  const code = error?.message || "INVALID_EVENT";
  return { status: 400, body: { ok: false, error: code } };
}
