function resetFaqForm() {
  state.faqEditingId = null;
  document.getElementById("faqQuestion").value = "";
  document.getElementById("faqAnswer").value = "";
  document.getElementById("faqCategory").value = "";
  document.getElementById("faqSortOrder").value = "0";
  document.getElementById("faqPublished").checked = true;
  document.getElementById("faqCancelEdit").hidden = true;
  document.getElementById("faqSave").textContent = "Tambah FAQ";
}

function resetHelpForm() {
  state.helpEditingId = null;
  document.getElementById("helpTitle").value = "";
  document.getElementById("helpContent").value = "";
  document.getElementById("helpCategory").value = "";
  document.getElementById("helpSortOrder").value = "0";
  document.getElementById("helpPublished").checked = true;
  document.getElementById("helpCancelEdit").hidden = true;
  document.getElementById("helpSave").textContent = "Tambah Artikel";
}

async function loadFaq(session) {
  const response = await ownerRequest("/api/owner/faq?limit=50&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca FAQ.");
  const list = document.getElementById("owner-faqList");
  if (!list) return;
  const rows = Array.isArray(data.faq) ? data.faq : [];
  list.innerHTML = rows.length ? rows.map((x) => `<div class="owner-crud-row"><div><strong>${escapeHtml(x.question)}</strong><small>${escapeHtml(x.category || "Tanpa kategori")} · urutan ${Number(x.sort_order)||0} · ${x.published ? "published" : "draft"}</small><p>${escapeHtml(x.answer)}</p></div><div class="btn-row"><button class="btn faq-edit" type="button" data-id="${escapeHtml(x.id)}">Edit</button><button class="btn danger faq-delete" type="button" data-id="${escapeHtml(x.id)}">Hapus</button></div></div>`).join("") : `<div class="status info">Belum ada FAQ.</div>`;
}

async function saveFaq(session) {
  const question = document.getElementById("faqQuestion")?.value.trim() || "";
  const answer = document.getElementById("faqAnswer")?.value.trim() || "";
  const category = document.getElementById("faqCategory")?.value.trim() || null;
  const sort_order = Number(document.getElementById("faqSortOrder")?.value || 0);
  const published = document.getElementById("faqPublished")?.checked === true;
  if (!question || !answer) throw new Error("Question dan answer wajib diisi.");
  const path = state.faqEditingId ? `/api/owner/faq/${encodeURIComponent(state.faqEditingId)}` : "/api/owner/faq";
  const response = await ownerRequest(path, session, { method: state.faqEditingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, answer, category, sort_order: Number.isInteger(sort_order) ? sort_order : 0, published }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "FAQ gagal disimpan.");
  resetFaqForm();
  document.getElementById("faqStatus").textContent = "FAQ berhasil disimpan.";
  await loadFaq(session);
}

async function editFaq(session, id) {
  const response = await ownerRequest(`/api/owner/faq?limit=50&offset=0`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "FAQ gagal dimuat.");
  const item = (data.faq || []).find((x) => x.id === id);
  if (!item) throw new Error("FAQ tidak ditemukan di halaman saat ini.");
  state.faqEditingId = id;
  document.getElementById("faqQuestion").value = item.question || "";
  document.getElementById("faqAnswer").value = item.answer || "";
  document.getElementById("faqCategory").value = item.category || "";
  document.getElementById("faqSortOrder").value = String(Number(item.sort_order) || 0);
  document.getElementById("faqPublished").checked = item.published !== false;
  document.getElementById("faqCancelEdit").hidden = false;
  document.getElementById("faqSave").textContent = "Simpan Perubahan";
}

async function deleteFaq(session, id) {
  const confirmed = await window.JYYRNotify?.confirm?.("Hapus FAQ ini?", {
    title: "Hapus FAQ",
    confirmText: "Hapus",
    cancelText: "Batal",
    danger: true,
  });
  if (!confirmed) return;
  const response = await ownerRequest(`/api/owner/faq/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "FAQ gagal dihapus.");
  await loadFaq(session);
}

async function loadHelp(session) {
  const response = await ownerRequest("/api/owner/help?limit=50&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca Help Center.");
  const list = document.getElementById("owner-helpList");
  if (!list) return;
  const rows = Array.isArray(data.help) ? data.help : [];
  list.innerHTML = rows.length ? rows.map((x) => `<div class="owner-crud-row"><div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.slug)} · ${escapeHtml(x.category || "Tanpa kategori")} · urutan ${Number(x.sort_order)||0} · ${x.published ? "published" : "draft"}</small><p>${escapeHtml(x.content)}</p></div><div class="btn-row"><button class="btn help-edit" type="button" data-id="${escapeHtml(x.id)}">Edit</button><button class="btn danger help-delete" type="button" data-id="${escapeHtml(x.id)}">Hapus</button></div></div>`).join("") : `<div class="status info">Belum ada artikel.</div>`;
}

function slugify(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 240) || "help";
}

async function saveHelp(session) {
  const title = document.getElementById("helpTitle")?.value.trim() || "";
  const content = document.getElementById("helpContent")?.value.trim() || "";
  const category = document.getElementById("helpCategory")?.value.trim() || null;
  const sort_order = Number(document.getElementById("helpSortOrder")?.value || 0);
  const published = document.getElementById("helpPublished")?.checked === true;
  if (!title || !content) throw new Error("Title dan content wajib diisi.");
  const slug = slugify(title);
  const path = state.helpEditingId ? `/api/owner/help/${encodeURIComponent(state.helpEditingId)}` : "/api/owner/help";
  const response = await ownerRequest(path, session, { method: state.helpEditingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, slug, content, category, sort_order: Number.isInteger(sort_order) ? sort_order : 0, published }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Help Center gagal disimpan.");
  resetHelpForm();
  document.getElementById("helpStatus").textContent = "Artikel berhasil disimpan.";
  await loadHelp(session);
}

async function editHelp(session, id) {
  const response = await ownerRequest("/api/owner/help?limit=50&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Help Center gagal dimuat.");
  const item = (data.help || []).find((x) => x.id === id);
  if (!item) throw new Error("Artikel tidak ditemukan di halaman saat ini.");
  state.helpEditingId = id;
  document.getElementById("helpTitle").value = item.title || "";
  document.getElementById("helpContent").value = item.content || "";
  document.getElementById("helpCategory").value = item.category || "";
  document.getElementById("helpSortOrder").value = String(Number(item.sort_order) || 0);
  document.getElementById("helpPublished").checked = item.published !== false;
  document.getElementById("helpCancelEdit").hidden = false;
  document.getElementById("helpSave").textContent = "Simpan Perubahan";
}

async function deleteHelp(session, id) {
  const confirmed = await window.JYYRNotify?.confirm?.("Hapus artikel Help Center ini?", {
    title: "Hapus Artikel",
    confirmText: "Hapus",
    cancelText: "Batal",
    danger: true,
  });
  if (!confirmed) return;
  const response = await ownerRequest(`/api/owner/help/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Artikel gagal dihapus.");
  await loadHelp(session);
}

/* =========================================================
   LOGIN ACTIVITY
========================================================= */
async function loadLoginActivity(session) {
  const query = new URLSearchParams({ limit: String(state.loginLimit), offset: String(state.loginPage * state.loginLimit) });
  const response = await ownerRequest(`/api/owner/login-activity?${query.toString()}`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca login activity.");
  state.loginTotal = Number(data.total) || 0;
  const pageCount = Math.max(1, Math.ceil(state.loginTotal / state.loginLimit));
  state.loginPage = Math.min(state.loginPage, pageCount - 1);
  const list = document.getElementById("loginActivityList");
  if (list) {
    list.innerHTML = (data.activity || []).map((x) => `<div><strong>${escapeHtml(x.email || x.display_name || x.user_id)}</strong><small>${escapeHtml(x.event || "login")} · ${x.success === false ? "failed" : "success"} · ${escapeHtml(x.created_at ? new Date(x.created_at).toLocaleString("id-ID") : "—")}</small>${x.ip_address ? `<small>IP: ${escapeHtml(x.ip_address)}</small>` : ""}</div>`).join("") || `<div>Belum ada aktivitas.</div>`;
  }
  const totalEl = document.getElementById("loginActivityTotal");
  if (totalEl) totalEl.textContent = `Total Login : ${state.loginTotal}`;
  renderPaginationControls("loginPaginationControls", state.loginPage, pageCount, async (target) => {
    state.loginPage = target;
    await loadLoginActivity(state.session);
  });
}

async function loadContentAdmin(session) {
  await Promise.all([loadFaq(session), loadHelp(session)]);
}

/* =========================================================
   EVENT BINDINGS
========================================================= */
