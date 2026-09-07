function renderOwnerStatistics(statistics) {
  const buckets = Array.isArray(statistics.sevenDays) ? statistics.sevenDays : [];
  const max = Math.max(1, ...buckets.map((item) => Number(item.count) || 0));
  const chart = document.getElementById("ownerChart");
  if (chart) {
    chart.innerHTML = buckets.map((item) => {
      const count = Number(item.count) || 0;
      const label = item.date ? new Date(`${item.date}T00:00:00Z`).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" }) : "—";
      return `<div class="bar-col"><span class="bar-value">${count}</span><div class="bar" style="height:${Math.max(4, (count / max) * 82)}%"></div><span class="bar-label">${label}</span></div>`;
    }).join("");
  }
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(Number(value) || 0); };
  set("todayCount", statistics.today); set("weekCount", statistics.week); set("monthCount", statistics.month);
}

async function loadHealth(session) {
  const response = await ownerRequest("/api/owner/health", session);
  const data = await parseJson(response);
  const db = data.database === "connected" && response.ok;
  const dbEl = document.getElementById("healthDatabase");
  const sbEl = document.getElementById("healthSupabase");
  const authEl = document.getElementById("healthAuth");
  const ownerHealth = document.getElementById("ownerHealth");
  if (dbEl) dbEl.textContent = `Database · ${db ? "Connected" : "Error"}`;
  if (sbEl) sbEl.textContent = `Supabase · ${db ? "Reachable" : "Error"}`;
  if (authEl) authEl.textContent = "Auth · Session verified";
  if (ownerHealth) ownerHealth.textContent = db ? "Supabase / Auth / Database Online" : "Owner health check error";
}

async function loadMaintenance(session) {
  const response = await ownerRequest("/api/owner/maintenance", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca maintenance.");
  const settings = data.settings || {};
  const button = document.getElementById("maintenanceToggle");
  const box = JYYROwnerRoot()?.querySelector(".maintenance");
  if (button) {
    button.dataset.enabled = settings.maintenance_enabled ? "1" : "0";
    button.textContent = settings.maintenance_enabled ? "Matikan Maintenance" : "Aktifkan Maintenance";
  }
  if (box) box.textContent = settings.maintenance_enabled ? (settings.maintenance_message || "Maintenance aktif") : "Web normal — maintenance OFF";
}

/* =========================================================
   BROADCAST MANAGEMENT
========================================================= */
