(() => {
  async function check() {
    try {
      const response = await fetch("/api/maintenance", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!data?.maintenance_enabled || data?.owner === true) {
        window.JYYRApp?.navigate("home", { replaceUrl: true });
        return;
      }
      const message = document.getElementById("maintenanceMessage");
      if (message && data.maintenance_message) message.textContent = data.maintenance_message;
    } catch {}
  }
  document.getElementById("maintenanceRefresh")?.addEventListener("click", check);
  check();
  window.setInterval(check, 15000);
})();
