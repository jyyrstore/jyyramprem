(() => {
  let running = false;

  async function check() {
    if (running || document.body?.dataset?.page !== "maintenance") return;
    running = true;
    try {
      const response = await window.JYYRNet.fetchWithTimeout(
        "/api/maintenance",
        { headers: { Accept: "application/json" }, cache: "no-store" },
        8000
      );
      const data = await response.json().catch(() => ({}));
      if (!data?.maintenance_enabled || data?.owner === true) {
        window.JYYRApp?.navigate("home", { replaceUrl: true });
        return;
      }
      const message = document.getElementById("maintenanceMessage");
      if (message && data.maintenance_message) message.textContent = data.maintenance_message;
    } catch {
      // Preserve the last known maintenance state on transient network failures.
    } finally {
      running = false;
    }
  }

  document.getElementById("maintenanceRefresh")?.addEventListener("click", check);
  check();
  window.setInterval(check, 15000);
})();
