import runtime from "../../lib/runtime/app-runtime.js";

const {
  db,
  semverParts,
  APP_RELEASE_PACKAGE,
  APP_RELEASE_BUCKET,
  releaseDownloadUrl,
  verifyStoredApk,
  removeStorageObject,
  isUuid,
} = runtime;

export function registerReleaseRoutes(app, deps) {
  const {
  ownerBroadcastReadLimiter,
  ownerMemberMutationLimiter,
  requireAuth,
  requireOwner,
} = deps;

  app.get("/app", (_req, res) => res.redirect(308, "/"));

  app.get("/api/app/latest", async (req, res) => {
    try {
      const channel = String(req.query?.channel || "stable").trim().toLowerCase();
      if (!["stable", "beta"].includes(channel)) return res.status(400).json({ ok: false, error: "Channel tidak valid." });
      const { data, error } = await db.from("app_releases")
        .select("id,app_key,platform,version,version_code,title,changelog,download_url,file_name,file_size_bytes,sha256,package_name,min_sdk,target_sdk,min_supported_version,mandatory_update,release_channel,status,published_at,created_at,updated_at")
        .eq("app_key", "jyyramprem").eq("platform", "android").eq("release_channel", channel).eq("status", "published")
        .order("version_code", { ascending: false }).order("published_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ ok: false, code: "NO_RELEASE", error: "Belum ada release tersedia." });
      return res.set("Cache-Control", "no-store, max-age=0").json({ ok: true, release: data });
    } catch (error) {
      console.error("[APP LATEST ERROR]", error);
      return res.status(500).json({ ok: false, error: "Gagal membaca release aplikasi." });
    }
  });

  app.get("/api/app/releases", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query?.limit || "20", 10) || 20, 1), 50);
      const channel = String(req.query?.channel || "stable").trim().toLowerCase();
      if (!["stable", "beta"].includes(channel)) return res.status(400).json({ ok: false, error: "Channel tidak valid." });
      const { data, error } = await db.from("app_releases")
        .select("id,app_key,platform,version,version_code,title,changelog,download_url,file_name,file_size_bytes,sha256,package_name,min_sdk,target_sdk,min_supported_version,mandatory_update,release_channel,status,published_at,created_at,updated_at")
        .eq("app_key", "jyyramprem").eq("platform", "android").eq("release_channel", channel).eq("status", "published")
        .order("version_code", { ascending: false }).order("published_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return res.set("Cache-Control", "no-store, max-age=0").json({ ok: true, releases: data || [] });
    } catch (error) {
      console.error("[APP RELEASES ERROR]", error);
      return res.status(500).json({ ok: false, error: "Gagal membaca riwayat release aplikasi." });
    }
  });

  app.post("/api/owner/app-releases/sign-upload", requireAuth, ownerMemberMutationLimiter, requireOwner, async (_req, res) => {
    try {
      const path = `incoming/${crypto.randomUUID()}.apk`;
      const { data, error } = await db.storage.from(APP_RELEASE_BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (error) throw error;
      return res.json({ ok: true, upload: { path, token: data.token, signedUrl: data.signedUrl, contentType: "application/vnd.android.package-archive" } });
    } catch (error) {
      console.error("[APP RELEASE SIGN UPLOAD ERROR]", error);
      return res.status(500).json({ ok: false, error: "Gagal menyiapkan upload APK." });
    }
  });

  app.get("/api/owner/app-releases", requireAuth, ownerBroadcastReadLimiter, requireOwner, async (_req, res) => {
    try {
      const { data, error } = await db.from("app_releases").select("*").eq("app_key", "jyyramprem").eq("platform", "android").order("version_code", { ascending: false }).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return res.json({ ok: true, owner: true, releases: data || [] });
    } catch (error) {
      console.error("[OWNER APP RELEASES ERROR]", error);
      return res.status(500).json({ ok: false, error: "Gagal membaca release aplikasi." });
    }
  });

  app.post("/api/owner/app-releases", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
    let incomingPath = "";
    try {
      const b = req.body || {};
      incomingPath = String(b.storage_path || "").trim();
      try { incomingPath = decodeURIComponent(incomingPath); } catch {}
      if (!/^incoming\/[0-9a-f-]{36}\.apk$/i.test(incomingPath)) return res.status(400).json({ ok: false, error: "Upload APK belum diterima Storage. Ulangi proses upload dari awal." });

      const verified = await verifyStoredApk(incomingPath);
      const m = verified.metadata;
      if (m.packageName !== APP_RELEASE_PACKAGE) return res.status(400).json({ ok: false, error: `Package Name APK tidak sesuai. Wajib ${APP_RELEASE_PACKAGE}.` });
      if (!semverParts(m.versionName)) return res.status(400).json({ ok: false, error: "versionName APK harus mengikuti format X.Y.Z." });

      const { data: existing, error: existingError } = await db.from("app_releases")
        .select("id,version,version_code,status,release_channel")
        .eq("app_key", "jyyramprem").eq("platform", "android")
        .or(`version.eq.${m.versionName},version_code.eq.${m.versionCode}`);
      if (existingError) throw existingError;
      if (existing?.length) return res.status(409).json({ ok: false, error: `Release v${m.versionName} / code ${m.versionCode} sudah ada. Gunakan Edit untuk mengubah metadata release yang existing.` });

      const channel = "stable";
      const statusValue = "published";
      const { data: latestStable, error: latestStableError } = await db.from("app_releases")
        .select("version,version_code").eq("app_key", "jyyramprem").eq("platform", "android")
        .eq("release_channel", channel).eq("status", "published")
        .order("version_code", { ascending: false }).limit(1).maybeSingle();
      if (latestStableError) throw latestStableError;
      if (latestStable && m.versionCode <= Number(latestStable.version_code || 0)) {
        return res.status(409).json({ ok: false, error: `Version Code APK harus lebih besar dari release stable terbaru (${latestStable.version_code}).` });
      }
      const { data: firstStable, error: firstStableError } = await db.from("app_releases")
        .select("version,version_code,published_at").eq("app_key", "jyyramprem").eq("platform", "android").eq("release_channel", "stable").eq("status", "published")
        .order("version_code", { ascending: true }).order("published_at", { ascending: true }).limit(1).maybeSingle();
      if (firstStableError) throw firstStableError;
      const minSupportedVersion = String(b.min_supported_version || "").trim() || firstStable?.version || m.versionName;
      if (!semverParts(minSupportedVersion)) return res.status(400).json({ ok: false, error: "Minimum Version tidak valid." });

      const canonicalPath = `android/${m.versionName}/JyyR-Amprem-${m.versionName}.apk`;
      const { error: uploadError } = await db.storage.from(APP_RELEASE_BUCKET).upload(canonicalPath, verified.buffer, {
        contentType: "application/vnd.android.package-archive", cacheControl: "31536000", upsert: false,
      });
      if (uploadError) throw uploadError;

      const changelog = Array.isArray(b.changelog) ? b.changelog.map((x) => String(x).trim()).filter(Boolean).slice(0, 30) : [];
      const payload = {
        app_key: "jyyramprem", platform: "android", version: m.versionName, version_code: m.versionCode,
        title: "Jyy'R Amprem", changelog, download_url: releaseDownloadUrl(canonicalPath), storage_path: canonicalPath,
        file_name: `JyyR-Amprem-${m.versionName}.apk`, file_size_bytes: verified.fileSizeBytes, sha256: verified.sha256,
        package_name: m.packageName, min_sdk: m.minSdk, target_sdk: m.targetSdk,
        min_supported_version: minSupportedVersion, mandatory_update: false, release_channel: channel,
        status: statusValue, published_at: new Date().toISOString(), created_by: req.user.id,
      };
      const { data, error } = await db.from("app_releases").insert(payload).select("*").single();
      if (error) { await removeStorageObject(canonicalPath); throw error; }
      await removeStorageObject(incomingPath);
      incomingPath = "";
      return res.status(201).json({ ok: true, owner: true, release: data, verified: { package_name: m.packageName, version: m.versionName, version_code: m.versionCode, file_size_bytes: verified.fileSizeBytes, sha256: verified.sha256, min_sdk: m.minSdk, target_sdk: m.targetSdk } });
    } catch (error) {
      await removeStorageObject(incomingPath);
      console.error("[OWNER APP RELEASE CREATE ERROR]", error);
      const duplicate = /duplicate key|unique constraint/i.test(String(error.message));
      return res.status(duplicate ? 409 : 500).json({ ok: false, error: duplicate ? "Release version atau version code tersebut sudah ada." : "APK gagal diverifikasi atau release gagal dibuat." });
    }
  });

  app.patch("/api/owner/app-releases/:id", requireAuth, ownerMemberMutationLimiter, requireOwner, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: "Release ID tidak valid." });
      const b = req.body || {};
      const { data: current, error: currentError } = await db.from("app_releases")
        .select("id,version,version_code,release_channel,status,min_supported_version")
        .eq("id", req.params.id).eq("app_key", "jyyramprem").eq("platform", "android").maybeSingle();
      if (currentError) throw currentError;
      if (!current) return res.status(404).json({ ok: false, error: "Release tidak ditemukan." });

      const patch = {};
      for (const key of ["title","min_supported_version"]) if (b[key] !== undefined) patch[key] = String(b[key] || "").trim() || null;
      if (b.changelog !== undefined) patch.changelog = Array.isArray(b.changelog) ? b.changelog.map((x) => String(x).trim()).filter(Boolean).slice(0,30) : [];
      if (b.mandatory_update !== undefined) patch.mandatory_update = Boolean(b.mandatory_update);
      if (b.status !== undefined) patch.status = ["draft","published","archived"].includes(String(b.status)) ? String(b.status) : undefined;
      if (b.release_channel !== undefined) patch.release_channel = ["stable","beta"].includes(String(b.release_channel)) ? String(b.release_channel) : undefined;
      if (b.status === "published") patch.published_at = new Date().toISOString();
      if (patch.min_supported_version && !semverParts(patch.min_supported_version)) return res.status(400).json({ ok: false, error: "Minimum version tidak valid." });
      if (Object.keys(patch).some((key) => patch[key] === undefined)) return res.status(400).json({ ok: false, error: "Metadata release tidak valid." });

      const nextChannel = patch.release_channel ?? current.release_channel;
      const nextStatus = patch.status ?? current.status;
      if (nextChannel === "stable" && nextStatus === "published") {
        const { data: newer, error: newerError } = await db.from("app_releases")
          .select("id,version_code").eq("app_key","jyyramprem").eq("platform","android")
          .eq("release_channel","stable").eq("status","published")
          .neq("id", current.id).order("version_code",{ascending:false}).limit(1).maybeSingle();
        if (newerError) throw newerError;
        if (newer && Number(current.version_code || 0) <= Number(newer.version_code || 0)) {
          return res.status(409).json({ ok:false, error:`Release stable published harus memiliki Version Code lebih besar dari stable terbaru (${newer.version_code}).` });
        }
      }

      const { data, error } = await db.from("app_releases").update(patch).eq("id", req.params.id).select("*").single();
      if (error) throw error;
      return res.json({ ok: true, owner: true, release: data });
    } catch (error) {
      console.error("[OWNER APP RELEASE UPDATE ERROR]", error);
      const duplicate = /duplicate key|unique constraint/i.test(String(error.message));
      return res.status(duplicate ? 409 : 500).json({ ok: false, error: duplicate ? "Perubahan release melanggar aturan unik database." : "Gagal memperbarui release aplikasi." });
    }
  });

}
