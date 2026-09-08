const icon = (name) => window.icon?.(name) || "";
const lockIcon = document.querySelector("#lockIcon");
if (lockIcon) lockIcon.innerHTML = icon("lock");

const status = (text, type = "info") => {
  const el = document.querySelector("#status");
  if (!el) return;
  el.textContent = text;
  el.className = "status flow-status-sr";
  window.JYYRNotify?.show(text, type);
};

(async () => {
  const button = document.querySelector("#resetBtn");
  const form = document.querySelector("#resetForm");
  const password = document.querySelector("#password");

  try {
    // getSession() now consumes Supabase's recovery URL fragment and stores the
    // resulting access/refresh tokens before removing them from the URL.
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
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: value }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.msg || data.message || data.error_description || "Gagal memperbarui password.");
        }

        await AMAuth.signOut();
        status("Password berhasil diperbarui. Silakan login kembali.", "success");
        setTimeout(() => window.JYYRApp?.navigate("login"), 1200);
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
})();
