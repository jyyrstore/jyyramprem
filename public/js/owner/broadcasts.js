function toDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderBroadcasts(data) {
  const list = document.getElementById("broadcastList");
  const total = document.getElementById("broadcastTotal");
  if (total) total.textContent = `Total: ${Number(data.total) || 0}`;
  if (!list) return;
  const rows = Array.isArray(data.broadcasts) ? data.broadcasts : [];
  if (!rows.length) {
    list.innerHTML = `<div class="broadcast-card"><strong>Belum ada broadcast</strong><p>Buat draft atau jadwal broadcast pertama.</p></div>`;
    return;
  }
  list.innerHTML = rows.map((b) => {
    const id = escapeHtml(b.id);
    const editable = b.status === "draft" || b.status === "scheduled";
    const deletable = b.status === "draft" || b.status === "cancelled" || b.status === "failed";
    const executable = b.status === "draft" || b.status === "scheduled";
    return `<article class="broadcast-card">
      <div class="broadcast-main">
        <div class="broadcast-title-row"><strong>${escapeHtml(b.title)}</strong>${broadcastStatusBadge(b.status)}</div>
        <p>${escapeHtml(b.message)}</p>
        <small>Target: ${escapeHtml(b.recipient_filter)} · Dibuat: ${escapeHtml(broadcastDate(b.created_at))}${b.scheduled_at ? ` · Jadwal: ${escapeHtml(broadcastDate(b.scheduled_at))}` : ""}</small>
      </div>
      <div class="broadcast-actions">
        <button class="round-btn broadcast-execute" type="button" data-id="${id}" ${executable ? "" : "disabled"} aria-label="Jalankan broadcast"><span>${icon("broadcast")}</span></button>
        <button class="round-btn danger broadcast-delete" type="button" data-id="${id}" ${deletable ? "" : "disabled"} aria-label="Hapus broadcast"><span>${icon("trash")}</span></button>
        <button class="round-btn broadcast-edit" type="button" data-id="${id}" ${editable ? "" : "disabled"} aria-label="Edit broadcast"><span>${icon("edit")}</span></button>
      </div>
    </article>`;
  }).join("");
}

async function loadBroadcasts(session) {
  const response = await ownerRequest("/api/owner/broadcasts?limit=20&offset=0", session);
  const data = await parseJson(response);
  if (response.status === 401) return redirectLogin();
  if (response.status === 403) return redirectHome();
  if (!response.ok) throw new Error(data.error || "Broadcast gagal dimuat");
  renderBroadcasts(data);
}

function resetBroadcastForm() {
  state.editingBroadcastId = null;
  document.getElementById("broadcastTitle").value = "";
  document.getElementById("broadcastMessage").value = "";
  document.getElementById("broadcastStatus").value = "draft";
  document.getElementById("broadcastFilter").value = "all";
  document.getElementById("broadcastScheduledAt").value = "";
  document.getElementById("broadcastScheduleWrap").hidden = true;
  document.getElementById("broadcastCancelEdit").hidden = true;
  document.getElementById("broadcastSave").textContent = "Simpan Broadcast";
}

async function editBroadcast(session, id) {
  const response = await ownerRequest(`/api/owner/broadcasts/${encodeURIComponent(id)}`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Broadcast gagal dimuat");
  const b = data.broadcast || {};
  state.editingBroadcastId = b.id;
  document.getElementById("broadcastTitle").value = b.title || "";
  document.getElementById("broadcastMessage").value = b.message || "";
  document.getElementById("broadcastStatus").value = b.status || "draft";
  document.getElementById("broadcastFilter").value = b.recipient_filter || "all";
  document.getElementById("broadcastScheduledAt").value = toDatetimeLocal(b.scheduled_at);
  document.getElementById("broadcastScheduleWrap").hidden = b.status !== "scheduled";
  document.getElementById("broadcastCancelEdit").hidden = false;
  document.getElementById("broadcastSave").textContent = "Simpan Perubahan";
  document.getElementById("broadcastTitle")?.focus();
}

async function saveBroadcast(session) {
  const title = document.getElementById("broadcastTitle")?.value.trim() || "";
  const message = document.getElementById("broadcastMessage")?.value.trim() || "";
  const status = document.getElementById("broadcastStatus")?.value || "draft";
  const recipient_filter = document.getElementById("broadcastFilter")?.value || "all";
  const scheduledLocal = document.getElementById("broadcastScheduledAt")?.value || "";
  const scheduled_at = scheduledLocal ? new Date(scheduledLocal).toISOString() : null;
  if (!title || !message) throw new Error("Judul dan pesan wajib diisi.");
  if (status === "scheduled" && !scheduled_at) throw new Error("Jadwal wajib diisi.");

  const statusLabels = { draft: "Draf", scheduled: "Terjadwal", sending: "Mengirim", sent: "Terkirim" };
  const statusLabel = statusLabels[status] || status;
  const confirmationMessage = status === "scheduled"
    ? `Simpan broadcast sebagai terjadwal?\n\nJadwal: ${broadcastDate(scheduled_at)}\nTarget: ${recipient_filter}\n\nBroadcast akan tetap terjadwal sampai waktunya tiba.`
    : status === "draft"
      ? `Simpan broadcast sebagai draf?\n\nTarget: ${recipient_filter}\n\nBroadcast belum akan dikirim.`
      : `Simpan perubahan broadcast dengan status ${statusLabel}?\n\nTarget: ${recipient_filter}`;
  const confirmed = await window.JYYRNotify?.confirm?.(confirmationMessage, {
    title: state.editingBroadcastId ? "Konfirmasi Perubahan Broadcast" : "Konfirmasi Broadcast",
    confirmText: status === "scheduled" ? "Jadwalkan" : status === "draft" ? "Simpan Draf" : "Simpan",
    cancelText: "Batal",
  });
  if (!confirmed) return false;

  const path = state.editingBroadcastId ? `/api/owner/broadcasts/${encodeURIComponent(state.editingBroadcastId)}` : "/api/owner/broadcasts";
  const response = await ownerRequest(path, session, {
    method: state.editingBroadcastId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, message, status, scheduled_at, recipient_filter }),
  });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Broadcast gagal disimpan");
  resetBroadcastForm();
  await loadBroadcasts(session);
  return true;
}

async function deleteBroadcast(session, id) {
  const confirmed = await window.JYYRNotify?.confirm?.("Hapus broadcast ini?", {
    title: "Hapus Broadcast",
    confirmText: "Hapus",
    cancelText: "Batal",
    danger: true,
  });
  if (!confirmed) return;
  const response = await ownerRequest(`/api/owner/broadcasts/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Broadcast gagal dihapus");
  await loadBroadcasts(session);
}

async function executeBroadcast(session, id) {
  const confirmed = await window.JYYRNotify?.confirm?.("Jalankan broadcast sekarang? Broadcast yang berhasil akan berstatus sent dan membuat notifikasi untuk target.", {
    title: "Jalankan Broadcast",
    confirmText: "Jalankan",
    cancelText: "Batal",
  });
  if (!confirmed) return;
  const response = await ownerRequest(`/api/owner/broadcasts/${encodeURIComponent(id)}/execute`, session, { method: "POST" });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Broadcast gagal dijalankan");
  ownerNotice(`Broadcast terkirim ke ${Number(data.recipients) || 0} member.`, "success");
  await loadBroadcasts(session);
}

/* =========================================================
   MESSAGING
========================================================= */
