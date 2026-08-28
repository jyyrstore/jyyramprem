export function extractProviderVerified(data) {
  const candidates = [
    data?.verified,
    data?.emailVerified,
    data?.email_verified,
    data?.data?.verified,
    data?.data?.emailVerified,
    data?.data?.email_verified,
    data?.result?.verified,
    data?.result?.emailVerified,
    data?.result?.email_verified,
    data?.profile?.emailVerified,
    data?.profile?.user?.emailVerified,
    data?.user?.emailVerified,
    data?.account?.emailVerified,
    data?.account?.user?.emailVerified,
    data?.data?.profile?.emailVerified,
    data?.data?.profile?.user?.emailVerified,
    data?.data?.user?.emailVerified,
    data?.data?.account?.emailVerified,
    data?.data?.account?.user?.emailVerified,
    data?.result?.profile?.emailVerified,
    data?.result?.profile?.user?.emailVerified,
    data?.result?.user?.emailVerified,
  ];

  for (const value of candidates) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

export function extractProviderIdToken(data) {
  const candidates = [
    data?.profile?.idToken,
    data?.idToken,
    data?.data?.profile?.idToken,
    data?.data?.idToken,
    data?.result?.profile?.idToken,
    data?.result?.idToken,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
