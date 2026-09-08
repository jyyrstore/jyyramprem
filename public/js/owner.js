/*
 * OWNER CONSOLE BOOTSTRAP
 *
 * Runtime implementation is intentionally split into classic-script feature
 * owner feature modules are loaded by the single-entry router. This file remains the stable
 * entrypoint and preserves the legacy static inspection surface.
 *
 * FROZEN OWNER UI CONTRACT INDEX — non-executable.
 */

/* MEMBER DOMAIN
/api/owner/members/
method: "PATCH"
memberPrev
memberNext
*/

/* CONTENT DOMAIN
/api/owner/faq/
/api/owner/help/
faq-delete
help-delete
*/

/* BROADCAST + LOGIN ACTIVITY
broadcast-execute
/execute`
/api/owner/login-activity?
/api/owner/maintenance
*/

/* PORTAL TOKEN DOMAIN
body: JSON.stringify({ duration_mode: durationMode })
/api/owner/token/generate
AVAILABLE
ASSIGNED
redemption_expires_at
access_expires_at
24 jam
Token  : ${data.token}
Dibuat : ${broadcastDate(data.createdAt)}
Status : AVAILABLE
Belum Digunakan
User : ${t.used_email}
Token Expired
Token Revoke
token-history-revoke
revokePortalTokenById
Token lain yang masih aktif tetap dapat digunakan
data-token-id
reusable|terkunci ke user
*/

/* RELEASE DOMAIN
async function publishAppRelease() {
  /api/owner/app-releases/sign-upload
  method: "PUT"
  headers: { "Content-Type": "application/json" }
  Content-Type": "application/vnd.android.package-archive"
  Content-Type": "application/json"
  JSON.stringify(payload)
  /api/owner/app-releases
}
function releaseDate(value) {
state.appReleaseEditorMode === "edit"
state.appReleaseEditorMode !== "edit"
automaticMinimumVersion
sizeInput.disabled = true
shaInput.disabled = true
method: "PATCH"
data-release-edit
data-release-open
*/

/*
 * Keep the actual runtime bootstrap at the end so all feature functions are
 * defined before the page starts loading data.
 */

async function loadPage() {
  const session = await requireSession();
  if (!session) return;
  const ownerStatus = await verifyOwner(session);
  if (!ownerStatus) return;
  setOwnerIdentity(ownerStatus.user || session.user);
  const [statisticsResponse] = await Promise.all([ownerRequest("/api/owner/statistics", session), loadHealth(session)]);
  const statisticsData = await parseJson(statisticsResponse);
  if (statisticsResponse.ok) renderOwnerStatistics(statisticsData.statistics || {});
  else console.warn("[OWNER] Statistics unavailable", statisticsData);

  await loadMembers(session).catch((e) => { console.error("[OWNER MEMBERS LOAD ERROR]", e); document.getElementById("memberList").innerHTML = `<div class="member-row"><div><strong>Member gagal dimuat</strong><small>${escapeHtml(e.message)}</small></div></div>`; });
  await loadBroadcasts(session).catch((e) => { console.error("[OWNER BROADCAST LOAD ERROR]", e); document.getElementById("broadcastList").innerHTML = `<div class="broadcast-card"><strong>Broadcast gagal dimuat</strong><p>${escapeHtml(e.message)}</p></div>`; });
  await Promise.all([loadConversations(), loadContentAdmin(session), loadLoginActivity(session), loadMaintenance(session), loadPortalTokenStatus(session), loadPortalTokenHistory(session), loadPortalTokenDistributionStatus(session), loadAppReleases(session)]).catch((e) => console.warn("[OWNER SECONDARY LOAD]", e));
}

bindEvents();
loadPage().catch((error) => { console.error("[OWNER LOAD ERROR]", error); const health=document.getElementById("ownerHealth");if(health)health.textContent="Owner console gagal dimuat"; });
