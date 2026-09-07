function bindEvents() {
  setupTabs();

  document.getElementById("memberSearch")?.addEventListener("input", (() => {
    let timer;
    return async () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        state.memberPage = 0;
        try { await loadMembers(state.session); } catch (e) { ownerNotice(e.message); }
      }, 300);
    };
  })());

  document.getElementById("memberStatusFilter")?.addEventListener("change", async () => {
    state.memberPage = 0;
    try { await loadMembers(state.session); } catch (e) { ownerNotice(e.message); }
  });


  document.getElementById("memberList")?.addEventListener("click", async (event) => {
    const edit = event.target.closest(".member-edit");
    const actionButton = event.target.closest(".member-action");
    const deleteButton = event.target.closest(".member-delete");
    const session = state.session || await requireSession();
    if (!session) return;
    try {
      if (edit) return await openMemberEditor(session, edit.dataset.id);
      if (deleteButton) {
        const confirmed = await window.JYYRNotify?.confirm?.(
          "Hapus akun member ini secara permanen?\n\nSemua akses akun dan data member terkait akan dihapus. Tindakan ini tidak dapat dibatalkan.",
          {
            title: "Hapus Member",
            confirmText: "Hapus Member",
            cancelText: "Batal",
            danger: true,
          }
        );
        if (!confirmed) return;
        const response = await ownerRequest(`/api/owner/members/${encodeURIComponent(deleteButton.dataset.id)}`, session, {
          method: "DELETE",
        });
        const data = await parseJson(response);
        if (!response.ok) throw new Error(data.error || "Gagal menghapus akun member.");
        ownerNotice("Akun member berhasil dihapus secara permanen.", "success");
        state.memberPage = 0;
        return await loadMembers(session);
      }
      if (actionButton && !actionButton.disabled) await memberAction(session, actionButton.dataset.id, actionButton.dataset.action);
    } catch (error) { ownerNotice(error.message); }
  });
  document.getElementById("memberEditorClose")?.addEventListener("click", () => {
    state.memberEditingId = null;
    document.getElementById("memberEditor").hidden = true;
  });
  document.getElementById("memberEditorSave")?.addEventListener("click", async () => {
    const session = state.session || await requireSession(); if (!session) return;
    try { await saveMemberEditor(session); } catch (e) { ownerNotice(e.message); }
  });

  document.getElementById("broadcastStatus")?.addEventListener("change", (event) => {
    document.getElementById("broadcastScheduleWrap").hidden = event.target.value !== "scheduled";
  });
  document.getElementById("broadcastCancelEdit")?.addEventListener("click", resetBroadcastForm);
  document.getElementById("broadcastSave")?.addEventListener("click", async () => {
    const session = state.session || await requireSession(); if (!session) return;
    const button = document.getElementById("broadcastSave"); button.disabled = true;
    try {
      const saved = await saveBroadcast(session);
      if (saved !== false) ownerNotice("Broadcast berhasil disimpan.", "success");
    } catch (e) { document.getElementById("broadcastFormStatus").textContent = e.message; ownerNotice(e.message); } finally { button.disabled = false; }
  });
  document.getElementById("broadcastList")?.addEventListener("click", async (event) => {
    const edit = event.target.closest(".broadcast-edit");
    const del = event.target.closest(".broadcast-delete");
    const execute = event.target.closest(".broadcast-execute");
    if (!edit && !del && !execute) return;
    const session = state.session || await requireSession(); if (!session) return;
    const id = (edit || del || execute).dataset.id;
    (edit || del || execute).disabled = true;
    try {
      if (edit) await editBroadcast(session, id);
      else if (del) await deleteBroadcast(session, id);
      else await executeBroadcast(session, id);
    } catch (e) { ownerNotice(e.message); }
  });

  document.getElementById("messageStart")?.addEventListener("click", async () => { try { await startConversation(); } catch (e) { ownerNotice(e.message); } });
  document.getElementById("messageSend")?.addEventListener("click", async () => { try { await sendOwnerMessage(); } catch (e) { ownerNotice(e.message); } });
  document.getElementById("conversationList")?.addEventListener("click", async (event) => { const row = event.target.closest("[data-conversation-id]"); if (!row) return; try { await openConversation(row.dataset.conversationId); } catch (e) { ownerNotice(e.message); } });

  document.getElementById("faqSave")?.addEventListener("click", async () => { const s=state.session||await requireSession(); if(!s)return; try{await saveFaq(s);ownerNotice("FAQ berhasil disimpan.","success");}catch(e){ownerNotice(e.message);} });
  document.getElementById("faqCancelEdit")?.addEventListener("click", resetFaqForm);
  document.getElementById("faqList")?.addEventListener("click", async (event) => { const edit=event.target.closest(".faq-edit"),del=event.target.closest(".faq-delete");if(!edit&&!del)return;const s=state.session||await requireSession();if(!s)return;try{if(edit)await editFaq(s,edit.dataset.id);else await deleteFaq(s,del.dataset.id);}catch(e){ownerNotice(e.message);} });
  document.getElementById("helpSave")?.addEventListener("click", async () => { const s=state.session||await requireSession(); if(!s)return; try{await saveHelp(s);ownerNotice("Artikel berhasil disimpan.","success");}catch(e){ownerNotice(e.message);} });
  document.getElementById("helpCancelEdit")?.addEventListener("click", resetHelpForm);
  document.getElementById("helpList")?.addEventListener("click", async (event) => { const edit=event.target.closest(".help-edit"),del=event.target.closest(".help-delete");if(!edit&&!del)return;const s=state.session||await requireSession();if(!s)return;try{if(edit)await editHelp(s,edit.dataset.id);else await deleteHelp(s,del.dataset.id);}catch(e){ownerNotice(e.message);} });


  document.getElementById("maintenanceToggle")?.addEventListener("click", async () => {
    const s=state.session||await requireSession();if(!s)return;const b=document.getElementById("maintenanceToggle");
    const enabled=b.dataset.enabled!=="1";b.disabled=true;
    const confirmed = await window.JYYRNotify?.confirm?.(enabled ? "Aktifkan mode maintenance sekarang? Member akan melihat halaman maintenance." : "Matikan mode maintenance sekarang dan buka akses member kembali?", {
      title: enabled ? "Aktifkan Maintenance" : "Nonaktifkan Maintenance",
      confirmText: enabled ? "Aktifkan" : "Matikan",
      cancelText: "Batal",
    });
    if (!confirmed) return;
    try{const r=await ownerRequest("/api/owner/maintenance",s,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,message:"Jyy'R Amprem Sedang Maintenance"})});const d=await parseJson(r);if(!r.ok)throw new Error(d.error||"Gagal mengubah maintenance.");await loadMaintenance(s);ownerNotice(enabled?"Maintenance diaktifkan.":"Maintenance dimatikan.","success");}catch(e){ownerNotice(e.message);}finally{b.disabled=false;}
  });

  document.querySelectorAll("[data-token-duration]")?.forEach?.((button) => {
    button.addEventListener("click", () => {
      state.selectedPortalTokenDuration = String(button.dataset.tokenDuration || "permanent");
      document.querySelectorAll("[data-token-duration]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
  });

  document.getElementById("generatePortalToken")?.addEventListener("click", async () => {
    const s = state.session || await requireSession(); if (!s) return;
    const button = document.getElementById("generatePortalToken");
    if (!button || button.dataset.generating === "1") return;
    const durationMode = state.selectedPortalTokenDuration || "permanent";
    const modeLabel = portalTokenDurationLabel(durationMode);
    const quantity = Math.max(1, Math.min(1000, Number(document.getElementById("portalTokenGenerateQuantity")?.value || 1)));
    const confirmed = await ownerConfirm(`Buat ${quantity} token portal ${modeLabel}? Generate hanya menambah inventory dan tidak mengurangi quota distribusi.`, {
      title: "Generate Token Portal",
      confirmText: "Generate Token",
      cancelText: "Batal",
    });
    if (!confirmed) return;

    button.dataset.generating = "1";
    const stopLoading = window.JYYRNotify?.buttonLoading?.(button, `Generating ${modeLabel}…`, "loading") || (() => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    });
    try {
      await generatePortalToken(s);
      ownerNotice(`${quantity} token ${modeLabel} berhasil dibuat ke inventory.`, "success");
    } catch (e) {
      console.error("[OWNER TOKEN GENERATE UI ERROR]", e);
      ownerNotice(e?.message || "Gagal membuat token.");
    } finally {
      try { stopLoading(); } catch {}
      button.dataset.generating = "0";
      button.removeAttribute("aria-busy");
      button.disabled = false;
    }
  });
  document.getElementById("revokePortalToken")?.addEventListener("click", async () => {
    const s = state.session || await requireSession(); if (!s) return;
    const activeTokenId = state.activePortalTokenId;
    if (!isPortalTokenId(activeTokenId)) return;
    const tokenRow = Array.from(document.querySelectorAll(".token-history-table tbody tr[data-token-id]")).find((row) => row.dataset.tokenId === String(activeTokenId));
    const tokenText = tokenRow?.querySelector(".token-history-token")?.textContent?.trim() || "token aktif";
    const confirmed = await window.JYYRNotify?.confirm?.(`Verifikasi pencabutan\n\nToken ${tokenText} akan dicabut dan tidak dapat digunakan lagi.\nToken lain yang masih aktif tetap dapat digunakan.\n\nLanjutkan?`, {
      title: "Verifikasi Pencabutan Token",
      confirmText: "Cabut Token",
      cancelText: "Batal",
      danger: true,
    });
    if (!confirmed) return;
    const b = document.getElementById("revokePortalToken"); b.disabled = true;
    try {
      await revokePortalToken(s, activeTokenId);
      ownerNotice("Token berhasil dicabut.", "success");
    } catch (e) { ownerNotice(e.message); }
    finally { await loadPortalTokenStatus(s).catch(() => {}); }
  });

  document.getElementById("portalTokenHistory")?.addEventListener("click", async (event) => {
    const publish = event.target.closest(".token-history-publish");
    const unpublish = event.target.closest(".token-history-unpublish");
    const revoke = event.target.closest(".token-history-revoke");
    if (!publish && !unpublish && !revoke) return;
    const s = state.session || await requireSession(); if (!s) return;
    const button = publish || unpublish || revoke;
    const tokenId = button.dataset.publishTokenId || button.dataset.unpublishTokenId || button.dataset.revokeTokenId;
    button.disabled = true;
    try {
      if (publish) {
        const data = await publishPortalTokenById(s, tokenId);
        ownerNotice(`Token berhasil disebarkan. Distribusi: ${Number(data.publish_count || 0)}/5.`, "success");
      } else if (unpublish) {
        await unpublishPortalTokenById(s, tokenId);
        ownerNotice("Publikasi token dihentikan.", "success");
      } else {
        const confirmed = await window.JYYRNotify?.confirm?.(`Cabut token ini? Token tidak dapat digunakan lagi.`, { title: "Cabut Token", confirmText: "Cabut", cancelText: "Batal", danger: true });
        if (!confirmed) return;
        await revokePortalTokenById(s, tokenId);
        ownerNotice("Token berhasil dicabut.", "success");
      }
      state.tokenHistoryPage = 0;
      await Promise.all([loadPortalTokenHistory(s), loadPortalTokenStatus(s), loadPortalTokenDistributionStatus(s)]);
    } catch (e) { ownerNotice(e.message); } finally { button.disabled = false; }
  });

  document.getElementById("copyGeneratedPortalToken")?.addEventListener("click", copyGeneratedPortalToken);
  document.getElementById("refreshPortalTokenHistory")?.addEventListener("click", async () => {
    const s = state.session || await requireSession(); if (!s) return;
    try { await loadPortalTokenHistory(s); } catch (e) { ownerNotice(e.message); }
  });

  document.getElementById("releaseFile")?.addEventListener("change", async (event) => {
    try { await handleApkSelection(event.target.files?.[0]); }
    catch (e) {
      event.target.value = "";
      state.appReleaseSelectedFile = null;
      state.appReleaseSelectedMetadata = null;
      const s = document.getElementById("releaseUploadStatus");
      if (s) { s.className = "status info"; s.textContent = "APK tidak valid. Lihat notifikasi di bagian atas."; }
      ownerNotice(e.message);
    }
  });

  document.getElementById("releasePublish")?.addEventListener("click", async () => {
    const button = document.getElementById("releasePublish");
    try {
      button.disabled = true;
      if (state.appReleaseEditorMode === "edit") {
        await saveAppReleaseEdit();
      } else {
        await publishAppRelease();
      }
    } catch (e) {
      const s = document.getElementById("releaseUploadStatus");
      if (s) { s.className = "status info"; s.textContent = "Proses gagal. Lihat notifikasi di bagian atas."; }
      ownerNotice(e.message);
    } finally { button.disabled = false; }
  });
  document.getElementById("releaseCancelEdit")?.addEventListener("click", resetAppReleaseEditor);
  document.getElementById("ownerReleaseList")?.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-release-edit]");
    const openButton = event.target.closest("[data-release-open]");
    if (!editButton && !openButton) return;
    const session = state.session || await requireSession();
    if (!session) return;
    try {
      if (editButton) await openAppReleaseEditor(editButton.dataset.releaseEdit);
      else if (openButton) window.open(openButton.dataset.releaseOpen, "_blank", "noopener,noreferrer");
    } catch (e) { ownerNotice(e.message); }
  });
  document.getElementById("releaseRefresh")?.addEventListener("click", async () => { const s=state.session || await requireSession(); if(s) await loadAppReleases(s).catch(e=>ownerNotice(e.message)); });

  document.getElementById("refreshPage")?.addEventListener("click", () => location.reload());
  document.getElementById("logoutBtn")?.addEventListener("click", async () => { await AMAuth.signOut(); redirectLogin(); });
  document.getElementById("logoutBtnTop")?.addEventListener("click", async () => { await AMAuth.signOut(); redirectLogin(); });
}
