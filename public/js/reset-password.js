window.JYYRRegisterView("reset-password", async (root) => {
  const icon = (name) => window.icon?.(name) || "";
  root.querySelector("#reset-password-lockIcon")?.replaceChildren();
  const lockIcon = root.querySelector("#reset-password-lockIcon");
  if (lockIcon) lockIcon.innerHTML = icon("lock");

  const status = (text, type = "info") => {
    const el = root.querySelector("#reset-password-status");
    if (!el) return;
    el.textContent = text;
    el.className = `status flow-status-sr ${type}`;
    window.JYYRNotify?.show(text, type);
  };

  const button = root.querySelector("#resetBtn");
  const form = root.querySelector("#resetForm");
  const password = root.querySelector("#reset-password-password");

  try {
    const session = await AMAuth.getSession();
    if (!session?.access_token) {
      status("Link reset tidak valid atau sudah kedaluwarsa.", "error");
      if (button) button.disabled = true;
      return;
    }

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = password?.value || "";
      if (value.length < 8) {
        status("Password minimal 8 karakter.", "error");
        return;
      }

      const stopLoading = window.JYYRNotify?.buttonLoading(button, "Menyimpan…");
      try {
        const cfg = await AMAuth.getConfig();
        const response = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
          method: "PUT",
          headers: {
            apikey: cfg.supabasePublishableKey,
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ password: value })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.msg || data.message || data.error_description || "Gagal memperbarui password.");
        await AMAuth.signOut();
        status("Password berhasil diperbarui. Silakan login kembali.", "success");
        setTimeout(() => window.JYYRApp?.showView("login"), 1200);
      } catch (error) {
        status(error?.message || "Gagal memperbarui password.", "error");
      } finally {
        stopLoading?.();
      }
    });
  } catch {
    status("Konfigurasi reset password tidak tersedia.", "error");
    if (button) button.disabled = true;
  }
});
