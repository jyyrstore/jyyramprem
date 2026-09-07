window.JYYRRegisterView("help", async (root, options = {}) => {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  async function load() {
    const [fr, hr] = await Promise.all([
      fetch("/api/faq", { cache: "no-store" }),
      fetch("/api/help", { cache: "no-store" })
    ]);
    const fd = await fr.json().catch(() => ({}));
    const hd = await hr.json().catch(() => ({}));
    const f = Array.isArray(fd.faq) ? fd.faq : [];
    const h = Array.isArray(hd.help) ? hd.help : [];
    root.querySelector("#help-faqList").innerHTML = f.length
      ? f.map((x) => `<article class="help-item"><h3>${esc(x.question)}</h3><p>${esc(x.answer)}</p><small class="help-meta">${esc(x.category || "Umum")}</small></article>`).join("")
      : '<div class="log muted">Belum ada FAQ yang dipublikasikan.</div>';
    root.querySelector("#help-helpList").innerHTML = h.length
      ? h.map((x) => `<article class="help-item" id="${esc(x.slug || "")}"><h3>${esc(x.title)}</h3><p>${esc(x.content)}</p><small class="help-meta">${esc(x.category || "Panduan")}</small></article>`).join("")
      : '<div class="log muted">Belum ada artikel yang dipublikasikan.</div>';

    const section = options.section;
    if (section) {
      const target = root.querySelector(`#${CSS.escape(String(section))}`) || root.querySelector("#help-helpList");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  await load().catch((e) => console.error("[HELP]", e));
});
