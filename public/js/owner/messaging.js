function renderConversations(data) {
  const list = document.getElementById("conversationList");
  if (!list) return;
  const rows = Array.isArray(data.conversations) ? data.conversations : [];
  if (!rows.length) {
    list.innerHTML = `<div class="member-row"><strong>Belum ada percakapan</strong><small>Buat percakapan dari Member UUID.</small></div>`;
    return;
  }
  list.innerHTML = rows.map((c) => `<button class="member-row conversation-row" type="button" data-conversation-id="${escapeHtml(c.conversation_id)}"><div><strong>${escapeHtml(c.display_name || c.email || c.member_user_id)}</strong><small>${escapeHtml(c.last_message || "Belum ada pesan")}</small></div><div>${memberBadge(c.status || "active")}<small>${Number(c.unread_count) || 0} belum dibaca</small></div></button>`).join("");
}

async function loadConversations() {
  const session = state.session || await requireSession();
  if (!session) return;
  const response = await ownerRequest("/api/owner/messages?limit=20&offset=0", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal memuat percakapan.");
  renderConversations(data);
}

async function openConversation(id) {
  const session = state.session || await requireSession();
  if (!session) return;
  const response = await ownerRequest(`/api/owner/messages/${encodeURIComponent(id)}?limit=100&offset=0`, session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membuka percakapan.");
  state.activeConversationId = id;
  document.getElementById("messageThread").hidden = false;
  document.getElementById("messageThreadHead").textContent = `${data.member?.display_name || data.member?.email || data.member?.user_id || "Member"} · ${data.member?.status || "active"}`;
  document.getElementById("messageThreadList").innerHTML = (data.messages || []).map((m) => `<div class="message-bubble"><strong>${m.sender_user_id === data.member?.user_id ? "Member" : "Owner"}</strong><p>${escapeHtml(m.body)}</p><small>${escapeHtml(broadcastDate(m.sent_at))}</small></div>`).join("") || `<div class="status info">Belum ada pesan.</div>`;
}

async function startConversation() {
  const memberId = document.getElementById("messageMemberId")?.value.trim() || "";
  if (!memberId) throw new Error("Member UUID wajib diisi.");
  const session = state.session || await requireSession();
  if (!session) return;
  const response = await ownerRequest("/api/owner/messages", session, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ member_id: memberId }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membuat percakapan.");
  await loadConversations();
  await openConversation(data.conversation.id);
}

async function sendOwnerMessage() {
  if (!state.activeConversationId) throw new Error("Pilih percakapan terlebih dahulu.");
  const body = document.getElementById("messageBody")?.value.trim() || "";
  if (!body) throw new Error("Pesan wajib diisi.");
  const session = state.session || await requireSession();
  if (!session) return;
  const response = await ownerRequest(`/api/owner/messages/${encodeURIComponent(state.activeConversationId)}`, session, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal mengirim pesan.");
  document.getElementById("messageBody").value = "";
  await openConversation(state.activeConversationId);
  await loadConversations();
}

/* =========================================================
   FAQ / HELP CRUD
========================================================= */
