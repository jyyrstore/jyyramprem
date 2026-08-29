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

  function ensureDialogStyles() {
    if (document.getElementById("globalDialogStyles")) return;
    const style = document.createElement("style");
    style.id = "globalDialogStyles";
    style.textContent = `
      .global-dialog-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(4,3,8,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:0;transition:opacity .18s ease;}
      .global-dialog-backdrop.is-visible{opacity:1;}
      .global-dialog{width:min(100%,460px);box-sizing:border-box;border:1px solid rgba(196,128,255,.25);border-radius:16px;background:linear-gradient(180deg,#1b1820 0%,#121016 100%);box-shadow:0 24px 70px rgba(0,0,0,.48),0 0 36px rgba(161,82,255,.12);transform:translateY(8px) scale(.985);transition:transform .18s ease;}
      .global-dialog-backdrop.is-visible .global-dialog{transform:translateY(0) scale(1);}
      .global-dialog-head{display:flex;align-items:center;gap:12px;padding:18px 18px 8px;}
      .global-dialog-icon{width:38px;height:38px;flex:0 0 38px;border:1px solid rgba(185,108,255,.22);border-radius:12px;display:grid;place-items:center;background:rgba(160,85,255,.08);}
      .global-dialog-icon img{width:20px;height:20px;object-fit:contain;}
      .global-dialog-title{margin:0;color:#f3edf7;font-size:16px;font-weight:800;}
      .global-dialog-body{padding:8px 18px 18px;color:#aaa3b1;font-size:13px;line-height:1.6;white-space:pre-line;}
      .global-dialog-input{display:block;width:100%;box-sizing:border-box;margin-top:12px;min-height:46px;padding:12px 13px;border:1px solid rgba(255,255,255,.10);border-radius:11px;outline:none;background:#0e0c12;color:#f2edf5;font:inherit;resize:vertical;}
      .global-dialog-input:focus{border-color:rgba(184,105,255,.58);box-shadow:0 0 0 3px rgba(167,86,255,.10);}
      .global-dialog-actions{display:flex;justify-content:flex-end;gap:9px;padding:0 18px 18px;}
      .global-dialog-btn{min-height:40px;padding:0 16px;border-radius:10px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.055);color:#e9e2ed;font:inherit;font-weight:750;cursor:pointer;}
      .global-dialog-btn:hover{border-color:rgba(185,108,255,.36);}
      .global-dialog-btn-primary{border-color:rgba(182,105,255,.45);background:linear-gradient(135deg,#9147ff,#c17bff);color:#fff;box-shadow:0 7px 22px rgba(153,74,255,.20);}
      .global-dialog-btn-danger{border-color:rgba(235,79,111,.35);background:rgba(103,30,50,.45);color:#ff9db0;}
      @media(max-width:430px){.global-dialog-backdrop{padding:14px}.global-dialog{border-radius:14px}.global-dialog-actions{flex-direction:row}.global-dialog-btn{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function openDialog(message, options = {}, mode = "confirm") {
    ensureDialogStyles();
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "global-dialog-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      const title = options.title || (mode === "prompt" ? "Input diperlukan" : "Konfirmasi");
      const confirmText = options.confirmText || "OK";
      const cancelText = options.cancelText || "Batal";
      const iconName = options.danger ? ICONS.error : (mode === "prompt" ? ICONS.info : ICONS.warning);
      const input = mode === "prompt" ? `<textarea class="global-dialog-input" rows="3" maxlength="500" placeholder="${esc(options.placeholder || "")}">${esc(options.value || "")}</textarea>` : "";
      backdrop.innerHTML = `
        <div class="global-dialog" tabindex="-1">
          <div class="global-dialog-head">
            <span class="global-dialog-icon" aria-hidden="true"><img src="${ICON_BASE}${encodeURIComponent(iconName)}" alt="" draggable="false"></span>
            <h2 class="global-dialog-title">${esc(title)}</h2>
          </div>
          <div class="global-dialog-body">${esc(message)}${input}</div>
          <div class="global-dialog-actions">
            <button class="global-dialog-btn global-dialog-cancel" type="button">${esc(cancelText)}</button>
            <button class="global-dialog-btn global-dialog-btn-primary ${options.danger ? "global-dialog-btn-danger" : ""} global-dialog-ok" type="button">${esc(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);
      const dialog = backdrop.querySelector(".global-dialog");
      const inputEl = backdrop.querySelector(".global-dialog-input");
      const ok = backdrop.querySelector(".global-dialog-ok");
      const cancel = backdrop.querySelector(".global-dialog-cancel");
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKeyDown, true);
        backdrop.classList.remove("is-visible");
        window.setTimeout(() => backdrop.remove(), 180);
        resolve(value);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") { event.preventDefault(); finish(mode === "prompt" ? null : false); }
        if (event.key === "Enter" && mode === "confirm" && !event.shiftKey) { event.preventDefault(); finish(true); }
      };
      cancel.addEventListener("click", () => finish(mode === "prompt" ? null : false));
      ok.addEventListener("click", () => finish(mode === "prompt" ? String(inputEl?.value || "").trim() : true));
      backdrop.addEventListener("click", (event) => { if (event.target === backdrop) finish(mode === "prompt" ? null : false); });
      document.addEventListener("keydown", onKeyDown, true);
      requestAnimationFrame(() => { backdrop.classList.add("is-visible"); (inputEl || ok || dialog)?.focus(); });
    });
  }

  window.JYYRNotify = {
    show: notify,
    confirm: (message, options = {}) => openDialog(message, options, "confirm"),
    prompt: (message, options = {}) => openDialog(message, options, "prompt"),
    buttonLoading,
    iconPath: (name) => `${ICON_BASE}${encodeURIComponent(ICONS[name] || name)}`
  };
})();
