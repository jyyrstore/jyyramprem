function automaticMinimumVersion(fallbackVersion) {
  const stablePublished = (Array.isArray(state.appReleases) ? state.appReleases : [])
    .filter((row) => row?.release_channel === "stable" && row?.status === "published" && /^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/.test(String(row.version || "")))
    .sort((a, b) => Number(a.version_code || 0) - Number(b.version_code || 0));
  return stablePublished[0]?.version || fallbackVersion;
}

async function handleApkSelection(file) {
  const status = document.getElementById("releaseUploadStatus");
  if (!file) return;
  if (!/\.apk$/i.test(file.name)) throw new Error("File harus berekstensi .apk.");
  if (status) { status.className = "status info"; status.textContent = "Membaca metadata APK…"; }
  if (typeof window.JYYRReadApkMetadata !== "function") throw new Error("Pembaca metadata APK belum siap. Muat ulang halaman Owner.");
  const metadata = await window.JYYRReadApkMetadata(file);
  if (metadata.packageName !== "com.jyystore.jyyramprem") throw new Error("Package Name tidak sesuai. APK Jyy'R Amprem wajib com.jyystore.jyyramprem.");
  if (!/^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/.test(String(metadata.versionName || ""))) throw new Error("versionName APK harus mengikuti format X.Y.Z.");
  if (!Number.isInteger(metadata.versionCode) || metadata.versionCode < 1) throw new Error("versionCode APK tidak valid.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  document.getElementById("releaseVersion").value = metadata.versionName;
  document.getElementById("releaseVersionCode").value = metadata.versionCode;
  document.getElementById("releaseFileSize").value = file.size;
  document.getElementById("releaseSha").value = sha256;
  document.getElementById("releasePackageName").value = metadata.packageName;
  document.getElementById("releaseMinSdk").value = metadata.minSdk;
  document.getElementById("releaseTargetSdk").value = metadata.targetSdk;
  document.getElementById("releaseMinVersion").value = automaticMinimumVersion(metadata.versionName);
  document.getElementById("releaseChannel").value = "stable";
  document.getElementById("releaseStatus").value = "published";
  document.getElementById("releaseMandatory").checked = false;
  state.appReleaseSelectedFile = file;
  state.appReleaseSelectedMetadata = { ...metadata, sha256, fileSizeBytes: file.size };
  if (status) { status.className = "status success"; status.textContent = `APK terbaca: v${metadata.versionName} · code ${metadata.versionCode} · ${file.size.toLocaleString("id-ID")} bytes.`; }
  return metadata;
}

async function publishAppRelease() {
  const status = document.getElementById("releaseUploadStatus");
  const file = document.getElementById("releaseFile")?.files?.[0];
  if (!file) throw new Error("Pilih APK terlebih dahulu.");
  if (!/\.apk$/i.test(file.name)) throw new Error("File harus berekstensi .apk.");

  const session = state.session || await requireSession(); if (!session) return;

  const metadata = await handleApkSelection(file);
  const version = document.getElementById("releaseVersion")?.value.trim();
  const versionCode = Number(document.getElementById("releaseVersionCode")?.value);
  if (!version || !Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error("Version, version code, dan APK wajib diisi.");
  }

  const apkContentType = file.type === "application/vnd.android.package-archive" || file.type === "application/octet-stream"
    ? file.type
    : "application/vnd.android.package-archive";

  status.textContent = "Menyiapkan upload aman…";
  const signResp = await ownerRequest("/api/owner/app-releases/sign-upload", session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version,
      version_code: versionCode,
      file_name: file.name,
      content_type: apkContentType
    })
  });
  const signData = await parseJson(signResp);
  if (!signResp.ok) throw new Error(signData.error || "Gagal menyiapkan upload.");

  status.textContent = "Mengupload APK…";

  // Supabase signed upload uses the APK itself as the request body.
  // Never wrap the APK in multipart/FormData: that would change the stored bytes.
  const uploadTimeoutMs = Math.max(30000, Math.min(120000, Number(file.size || 0) * 2));
  const uploadResponse = await window.JYYRNet.fetchWithTimeout(signData.upload.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
    },
    body: file
  }, uploadTimeoutMs);
  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text().catch(() => "");
    throw new Error(detail ? `Upload APK gagal: ${detail.slice(0, 220)}` : `Upload APK gagal (HTTP ${uploadResponse.status}).`);
  }

  const changelog = document.getElementById("releaseChangelog")?.value.split("\n").map(x => x.trim()).filter(Boolean) || [];
  const payload = { storage_path: signData.upload.path, changelog };
  status.textContent = "Server memverifikasi APK dari Storage…";
  const saveResp = await ownerRequest("/api/owner/app-releases", session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const saveData = await parseJson(saveResp);
  if (!saveResp.ok) throw new Error(saveData.error || "Gagal memverifikasi atau menyimpan release.");
  resetAppReleaseEditor();
  await loadAppReleases(session);
  window.JYYRNotify?.show(`Release v${saveData.release.version} berhasil dipublikasikan.`, "success", { title: "Release Berhasil" });
  return metadata;
}

function releaseDate(value) {
  if (!value) return "belum publish";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "belum publish" : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function releaseFileSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && n >= 1024; i++) { n /= 1024; unit = units[i]; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${unit}`;
}

function releaseStatusClass(row) {
  if (row.mandatory_update) return "red";
  if (row.status === "published") return "green";
  if (row.status === "archived") return "yellow";
  return "blue";
}

function setAppReleaseEditorMode(editing) {
  state.appReleaseEditorMode = editing ? "edit" : "create";
  const mode = document.getElementById("releaseEditorMode");
  const notice = document.getElementById("releaseEditNotice");
  const fileField = document.getElementById("releaseFileField");
  const fileInput = document.getElementById("releaseFile");
  const sizeField = document.getElementById("releaseFileSizeField");
  const shaField = document.getElementById("releaseShaField");
  const sizeInput = document.getElementById("releaseFileSize");
  const shaInput = document.getElementById("releaseSha");
  const version = document.getElementById("releaseVersion");
  const versionCode = document.getElementById("releaseVersionCode");
  const publishButton = document.getElementById("releasePublish");
  const cancelButton = document.getElementById("releaseCancelEdit");
  if (mode) { mode.textContent = editing ? "Edit" : "Create"; mode.className = `badge ${editing ? "yellow" : "blue"}`; }
  if (notice) notice.hidden = !editing;
  if (fileField) fileField.hidden = editing;
  if (sizeField) sizeField.hidden = false;
  if (shaField) shaField.hidden = false;
  if (sizeInput) { sizeInput.disabled = true; sizeInput.readOnly = true; }
  if (shaInput) { shaInput.disabled = true; shaInput.readOnly = true; }
  if (version) version.readOnly = true;
  if (versionCode) versionCode.readOnly = true;
  const packageInput = document.getElementById("releasePackageName");
  const minSdkInput = document.getElementById("releaseMinSdk");
  const targetSdkInput = document.getElementById("releaseTargetSdk");
  if (packageInput) packageInput.readOnly = true;
  if (minSdkInput) minSdkInput.readOnly = true;
  if (targetSdkInput) targetSdkInput.readOnly = true;
  const minVersion = document.getElementById("releaseMinVersion");
  const mandatory = document.getElementById("releaseMandatory");
  const channel = document.getElementById("releaseChannel");
  const releaseStatus = document.getElementById("releaseStatus");
  if (minVersion) minVersion.readOnly = !editing;
  if (mandatory) mandatory.disabled = !editing;
  if (channel) channel.disabled = !editing;
  if (releaseStatus) releaseStatus.disabled = !editing;
  if (fileInput && !editing) fileInput.value = "";
  if (publishButton) publishButton.textContent = editing ? "Simpan Perubahan" : "Upload & Publish";
  if (cancelButton) cancelButton.hidden = !editing;
}

function resetAppReleaseEditor() {
  state.appReleaseEditingId = null;
  state.appReleaseEditorMode = "create";
  const version = document.getElementById("releaseVersion");
  const versionCode = document.getElementById("releaseVersionCode");
  const fileSize = document.getElementById("releaseFileSize");
  const sha = document.getElementById("releaseSha");
  const packageName = document.getElementById("releasePackageName");
  const minSdk = document.getElementById("releaseMinSdk");
  const targetSdk = document.getElementById("releaseTargetSdk");
  const changelog = document.getElementById("releaseChangelog");
  const minVersion = document.getElementById("releaseMinVersion");
  const mandatory = document.getElementById("releaseMandatory");
  const channel = document.getElementById("releaseChannel");
  const status = document.getElementById("releaseStatus");
  const uploadStatus = document.getElementById("releaseUploadStatus");
  if (version) { version.value = ""; version.readOnly = true; }
  if (versionCode) { versionCode.value = ""; versionCode.readOnly = true; }
  if (fileSize) fileSize.value = "";
  if (sha) sha.value = "";
  if (packageName) packageName.value = "";
  if (minSdk) minSdk.value = "";
  if (targetSdk) targetSdk.value = "";
  if (changelog) changelog.value = "";
  if (minVersion) minVersion.value = "";
  if (mandatory) mandatory.checked = false;
  if (channel) channel.value = "stable";
  if (status) status.value = "published";
  if (uploadStatus) { uploadStatus.className = "status info"; uploadStatus.textContent = "Siap upload."; }
  setAppReleaseEditorMode(false);
}

async function openAppReleaseEditor(id) {
  const row = state.appReleases.find((item) => String(item.id) === String(id));
  if (!row) throw new Error("Release tidak ditemukan. Refresh history lalu coba lagi.");
  state.appReleaseEditingId = String(row.id);
  document.getElementById("releaseVersion").value = row.version || "";
  document.getElementById("releaseVersionCode").value = row.version_code ?? "";
  document.getElementById("releaseFileSize").value = row.file_size_bytes ?? "";
  document.getElementById("releaseSha").value = row.sha256 || "";
  document.getElementById("releasePackageName").value = row.package_name || "";
  document.getElementById("releaseMinSdk").value = row.min_sdk ?? "";
  document.getElementById("releaseTargetSdk").value = row.target_sdk ?? "";
  document.getElementById("releaseChangelog").value = Array.isArray(row.changelog) ? row.changelog.join("\n") : "";
  document.getElementById("releaseMinVersion").value = row.min_supported_version || "";
  document.getElementById("releaseMandatory").checked = !!row.mandatory_update;
  document.getElementById("releaseChannel").value = row.release_channel || "stable";
  document.getElementById("releaseStatus").value = row.status || "draft";
  setAppReleaseEditorMode(true);
  const status = document.getElementById("releaseUploadStatus");
  if (status) { status.className = "status info"; status.textContent = `Mengedit v${row.version} · code ${row.version_code}.`; }
  document.getElementById("app-release")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveAppReleaseEdit() {
  const session = state.session || await requireSession();
  if (!session) return;
  const id = state.appReleaseEditingId;
  if (state.appReleaseEditorMode !== "edit" || !id) {
    throw new Error("Tidak ada release yang sedang diedit.");
  }
  const fileSizeValue = document.getElementById("releaseFileSize")?.value.trim() || "";
  const sha256 = document.getElementById("releaseSha")?.value.trim().toLowerCase() || "";
  const version = document.getElementById("releaseVersion")?.value.trim() || "";
  const changelog = document.getElementById("releaseChangelog")?.value.split("\n").map(x => x.trim()).filter(Boolean) || [];
  const minVersion = document.getElementById("releaseMinVersion")?.value.trim() || null;
  const mandatory = !!document.getElementById("releaseMandatory")?.checked;
  const channel = document.getElementById("releaseChannel")?.value || "stable";
  const statusValue = document.getElementById("releaseStatus")?.value || "draft";
  if (!/^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Version harus mengikuti format X.Y.Z.");
  if (!['stable', 'beta'].includes(channel)) throw new Error("Channel tidak valid.");
  if (!['draft', 'published', 'archived'].includes(statusValue)) throw new Error("Status tidak valid.");
  const payload = {
    title: "Jyy'R Amprem",
    changelog,
    min_supported_version: minVersion,
    mandatory_update: mandatory,
    release_channel: channel,
    status: statusValue,
  };
  const status = document.getElementById("releaseUploadStatus");
  if (status) { status.className = "status info"; status.textContent = "Menyimpan perubahan release…"; }
  const response = await ownerRequest(`/api/owner/app-releases/${encodeURIComponent(id)}`, session, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal memperbarui release.");
  resetAppReleaseEditor();
  await loadAppReleases(session);
  window.JYYRNotify?.show(`Release v${version} berhasil diperbarui.`, "success", { title: "Release Diperbarui" });
}

async function loadAppReleases(session) {
  const response = await ownerRequest("/api/owner/app-releases", session);
  const data = await parseJson(response);
  if (!response.ok) throw new Error(data.error || "Gagal membaca release aplikasi.");
  const container = document.getElementById("ownerReleaseList");
  if (!container) return;
  const rows = data.releases || [];
  state.appReleases = rows;
  const count = document.getElementById("releaseHistoryCount");
  if (count) count.textContent = `${rows.length} release`;
  container.innerHTML = rows.length ? rows.map((r) => {
    const statusText = r.mandatory_update ? "WAJIB" : String(r.status || "draft").toUpperCase();
    const size = releaseFileSize(r.file_size_bytes);
    const sha = r.sha256 ? `${String(r.sha256).slice(0, 12)}…` : "SHA belum diisi";
    const downloadUrl = r.download_url ? String(r.download_url) : "";
    return `
      <article class="app-release-row">
        <div class="app-release-row-main">
          <div class="app-release-row-top">
            <div>
              <strong class="app-release-version">v${escapeHtml(r.version)} <span>· code ${escapeHtml(r.version_code)}</span></strong>
              <span class="badge ${releaseStatusClass(r)}">${escapeHtml(statusText)}</span>
            </div>
            <span class="app-release-channel">${escapeHtml(String(r.release_channel || "stable"))}</span>
          </div>
          <div class="app-release-row-meta">
            <span>${escapeHtml(releaseDate(r.published_at))}</span>
            <span>${escapeHtml(size)}</span>
            <span>${escapeHtml(sha)}</span>
          </div>
          <p class="app-release-row-changelog">${escapeHtml(Array.isArray(r.changelog) && r.changelog.length ? r.changelog.join(" · ") : "Tidak ada changelog.")}</p>
        </div>
        <div class="app-release-row-actions">
          <button class="btn app-release-edit-btn" type="button" data-release-edit="${escapeHtml(r.id)}">Edit</button>
          ${downloadUrl ? `<button class="btn app-release-open-btn" type="button" data-release-open="${escapeHtml(downloadUrl)}">Buka APK</button>` : ""}
        </div>
      </article>`;
  }).join("") : `<div class="status info">Belum ada release.</div>`;
}
