function renderMembers(data) {
  const list = document.getElementById("memberList");
  const total = Number(data.total) || 0;
  state.memberTotal = total;
  const pageCount = Math.max(1, Math.ceil(total / state.memberLimit));
  const page = Math.min(state.memberPage, pageCount - 1);
  state.memberPage = page;
  document.getElementById("memberTotal")?.replaceChildren(document.createTextNode(`Total Member : ${total}`));
  renderPaginationControls("memberPaginationControls", page, pageCount, async (target) => {
    state.memberPage = target;
    await loadMembers(state.session);
  });
  const members = Array.isArray(data.members) ? data.members : [];
  if (!list) return;
  if (!members.length) {
    list.innerHTML = `<div class="member-row"><div><strong>Tidak ada member</strong><small>Coba ubah pencarian atau filter.</small></div></div>`;
    return;
  }
  list.innerHTML = members.map((m) => {
    const id = escapeHtml(m.user_id);
    const email = escapeHtml(m.email || "—");
    const name = escapeHtml(m.display_name || email.split("@")[0]);
    const status = escapeHtml(m.status || "active");
    const notes = m.notes ? `<p class="member-notes">${escapeHtml(m.notes)}</p>` : "";
    return `<article class="member-row" data-member-id="${id}">
      <div class="member-main">
        <div class="member-identity">
          <div class="member-name-wrap">
            <strong class="member-name">${name}</strong>
            <small class="member-email">${email}</small>
          </div>
          ${memberBadge(status)}
        </div>
        ${notes}
      </div>
      <div class="member-actions" aria-label="Aksi member">
        <button class="btn member-edit" data-id="${id}" type="button">${icon("edit")}<span>Detail/Edit</span></button>
        <button class="btn member-action" data-action="suspend" data-id="${id}" type="button" ${status !== "active" ? "disabled" : ""}>${icon("lock")}<span>Suspend</span></button>
        <button class="btn member-action" data-action="ban" data-id="${id}" type="button" ${status === "banned" ? "disabled" : ""}>${icon("shield")}<span>Ban</span></button>
        <button class="btn member-action" data-action="unban" data-id="${id}" type="button" ${status === "active" ? "disabled" : ""}>${icon("unlock")}<span>Unban</span></button>
        <button class="btn danger member-delete" data-id="${id}" type="button">${icon("trash")}<span>Hapus Akun</span></button>
      </div>
    </article>`;
  }).join("");
}

async function loadMembers(session) {
  const search = document.getElementById("memberSearch")?.value?.trim() || "";
  const status = document.getElementById("memberStatusFilter")?.value || "";
  const query = new URLSearchParams({ limit: String(state.memberLimit), offset: String(state.memberPage * state.memberLimit) });
  if (search) query.set("search", search.slice(0, 100));
  if (status) query.set("status", status);
  const response = await ownerRequest(`/api/owner/members?${query.toString()}`, session);
  const data = await parseJson(response);
  if (response.status === 401) return redirectLogin();
  if (response.status === 403) return redirectHome();
  if (!response.ok) throw new Error(data.error || "Member gagal dimuat");
  renderMembers(data);
}

async function openMemberEditor(session, id) {
  const response = await ownerRequest(`/api/owner/members/${encodeURIComponent(id)}`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Detail member gagal dimuat.");
  const member = data.member || {};
  state.memberEditingId = id;
  document.getElementById("memberDisplayName").value = member.display_name || "";
  document.getElementById("memberNotes").value = member.notes || "";
  document.getElementById("memberEditorMeta").textContent = `${member.email || "—"} · ${member.status || "active"}`;
  document.getElementById("memberEditorStatus").textContent = "";
  document.getElementById("memberEditor").hidden = false;
  document.getElementById("memberDisplayName")?.focus();
}

async function saveMemberEditor(session) {
  if (!state.memberEditingId) throw new Error("Member belum dipilih.");
  const display_name = document.getElementById("memberDisplayName")?.value.trim() || "";
  const notes = document.getElementById("memberNotes")?.value || "";
  const response = await ownerRequest(`/api/owner/members/${encodeURIComponent(state.memberEditingId)}`, session, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name, notes }),
  });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal memperbarui member.");
  document.getElementById("memberEditorStatus").textContent = "Profil member berhasil diperbarui.";
  ownerNotice("Profil member berhasil diperbarui.", "success");
  await loadMembers(session);
}

async function memberAction(session, id, action) {
  const reason = await window.JYYRNotify?.prompt?.("Alasan perubahan status (opsional):", {
    title: "Perubahan Status Member",
    placeholder: "Masukkan alasan (opsional)",
    value: "",
    confirmText: "Simpan",
    cancelText: "Batal",
  });
  if (reason === null || reason === undefined) return;
  const response = await ownerRequest(`/api/owner/members/${encodeURIComponent(id)}/${action}`, session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason.slice(0, 500) }),
  });
  const data = await parseJson(response);
  if (response.status === 401) return redirectLogin();
  if (response.status === 403) return redirectHome();
  if (!response.ok) throw new Error(data.error || "Perubahan member gagal");
  await loadMembers(session);
}

/* =========================================================
   PORTAL ACCESS TOKEN
========================================================= */
