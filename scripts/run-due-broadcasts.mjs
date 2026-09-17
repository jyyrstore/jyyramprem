// Optional production worker for scheduled broadcasts.
// Usage: APP_URL=https://www.jyyramprem.my.id OWNER_ACCESS_TOKEN=... node scripts/run-due-broadcasts.mjs
// Keep OWNER_ACCESS_TOKEN server-side only.
const base = process.env.APP_URL;
const token = process.env.OWNER_ACCESS_TOKEN;

if (!base || !token) {
  console.error("APP_URL and OWNER_ACCESS_TOKEN are required.");
  process.exit(1);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const res = await fetchWithTimeout(`${base.replace(/\/$/, "")}/api/owner/broadcasts?status=scheduled`, {
  headers: { Authorization: `Bearer ${token}` }
});
if (!res.ok) throw new Error(`list scheduled broadcasts failed: ${res.status}`);
const payload = await res.json();
const items = Array.isArray(payload.items) ? payload.items : [];

const now = Date.now();
for (const item of items) {
  if (!item.scheduled_at || Date.parse(item.scheduled_at) > now) continue;
  const r = await fetchWithTimeout(`${base.replace(/\/$/, "")}/api/owner/broadcasts/${item.id}/execute`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await r.text();
  console.log(item.id, r.status, text);
}
