export function extractProviderEmail(data) {
  const candidates = [
    data?.email,
    data?.account?.email,
    data?.data?.email,
    data?.data?.account?.email,
    data?.profile?.user?.email,
    data?.data?.profile?.user?.email,
    data?.result?.profile?.user?.email,
    data?.user?.email,
    data?.data?.user?.email,
    data?.result?.user?.email,
    data?.result?.email,
  ];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().toLowerCase();
    if (trimmed) return { value: trimmed, path: "provider_response" };
  }
  return { value: null, path: null };
}

export function validateProviderContract(data, httpResponse) {
  const errors = [];
  if (!httpResponse?.ok) errors.push('HTTP_NOT_OK');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('JSON_OBJECT_REQUIRED');
    return { valid: false, errors };
  }
  if (data.success !== true) errors.push('SUCCESS_FLAG_FALSE');

  const email = extractProviderEmail(data).value;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('EMAIL_MISSING_OR_INVALID');
  }

  const premiumResult = data?.premium?.result ?? data?.premium?.data?.result ?? null;
  if (!premiumResult || typeof premiumResult !== 'object') {
    errors.push('PREMIUM_RESULT_MISSING');
  } else {
    if (premiumResult.status !== 'success') errors.push('PREMIUM_STATUS_NOT_SUCCESS');
    if (premiumResult.valid !== true) errors.push('PREMIUM_NOT_VALID');
  }

  return { valid: errors.length === 0, errors };
}

export function decodeJwtPayloadSafe(token) {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}
