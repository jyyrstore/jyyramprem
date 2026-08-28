/* JYY'R AMPREM — centralized micro-interaction + popup notification layer. */
(() => {
  const ICON_BASE = "/assets/Icon/";
  const ICONS = {
    success: "ceklis-2.png",
    error: "Peringatan.png",
    warning: "Darurat.png",
    info: "FAQ.png",
    loading: "Loading.png",
    copy: "salin.png"
  };

  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  function root() {
    let host = document.querySelector("#globalNotifications");
    if (!host) {
      host = document.createElement("div");
      host.id = "globalNotifications";
      host.className = "global-notifications";
      host.setAttribute("aria-live", "polite");
      host.setAttribute("aria-atomic", "true");
      document.body.appendChild(host);
    }
    return host;
  }

  function notify(message, type = "info", options = {}) {
    const host = root();
    const toast = document.createElement("div");
    const duration = Number(options.duration ?? 3200);
    const iconName = ICONS[type] || ICONS.info;

    toast.className = `app-toast app-toast-${type}`;
    toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
    toast.innerHTML = `
      <span class="app-toast-icon" aria-hidden="true">
        <img src="${ICON_BASE}${encodeURIComponent(iconName)}" alt="" draggable="false">
      </span>
      <span class="app-toast-body">
        <strong>${esc(options.title || ({
          success: "Berhasil",
          error: "Gagal",
          warning: "Peringatan",
          info: "Informasi"
        }[type] || "Informasi"))}</strong>
        <span>${esc(message)}</span>
      </span>
      <button class="app-toast-close" type="button" aria-label="Tutup"><img src="${ICON_BASE}cancel.png" alt="" draggable="false"></button>
    `;

    const close = () => {
      toast.classList.remove("is-visible");
      toast.classList.add("is-closing");
      window.setTimeout(() => toast.remove(), 180);
    };

    toast.querySelector(".app-toast-close")?.addEventListener("click", close);
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));

    if (duration > 0) {
      window.setTimeout(close, duration);
    }
    return close;
  }

  function buttonLoading(button, label = "Memproses…", icon = "loading") {
    if (!button) return () => {};
    const originalContent = button.innerHTML;
    button.disabled = true;
    button.classList.add("is-loading");
    button.innerHTML = `
      <img class="asset-ui-icon button-loading-icon" src="${ICON_BASE}${encodeURIComponent(ICONS[icon] || ICONS.loading)}" alt="" aria-hidden="true" draggable="false">
      <span>${esc(label)}</span>
    `;
    return () => {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.innerHTML = originalContent;
    };
  }

  window.JYYRNotify = {
    show: notify,
    buttonLoading,
    iconPath: (name) => `${ICON_BASE}${encodeURIComponent(ICONS[name] || name)}`
  };
})();
