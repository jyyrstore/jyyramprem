# Jyy'R Amprem — Final Technical Audit & Fix

Date: 2026-09-02

## Root cause of the screenshot error

The exact failure was in the Owner release flow: both JSON POST requests in `public/js/owner.js` were sending `JSON.stringify(...)` without an explicit `Content-Type: application/json`. Express JSON parsing therefore did not populate `req.body`; the server received an empty `storage_path` and returned `Upload APK belum valid atau sudah kedaluwarsa.`

That is why the APK metadata could already be visible in the form while the final upload step still failed.

## Fixes applied

- Added `Content-Type: application/json` to the signed-upload request and final release-finalization request.
- Changed the Supabase signed upload to send the **raw APK File as the PUT body**, not `FormData`/multipart. Supabase's current JavaScript reference documents `uploadToSignedUrl(path, token, file)` for signed uploads.
- APK CREATE now reads `versionName`, `versionCode`, package name, minimum SDK and target SDK automatically from `AndroidManifest.xml`.
- Browser calculates the immediate SHA-256 and actual byte size for UI feedback; these values are non-authoritative.
- Server re-downloads the incoming APK from Supabase Storage, recomputes SHA-256 and byte size, parses the manifest, validates the required package, version format and version code, and writes only server-verified metadata to `app_releases`.
- Minimum supported app version is auto-filled from the earliest published Stable release, with the uploaded APK version as fallback. This is intentionally distinct from Android `minSdkVersion`.
- Stable releases require a monotonically increasing `version_code` relative to the latest published Stable release.
- CREATE defaults remain Stable + Published + Mandatory Update OFF. Binary-derived fields remain read-only.
- Final release success/error uses the top notification as the primary user-facing notification; the release form status is kept as progress/help text so the same message is not rendered twice.
- Notification deduplication and close guards remain active.
- Reset logic now clears cached selected APK metadata as well.
- Public release APIs now return `Cache-Control: no-store, max-age=0` so newly published releases are visible immediately instead of waiting behind a 60-second cache.

## Verification

`npm test` — **PASS**. App-release contract: 13/13 tests passed.

`npm run verify` — **PASS** (`ok: true`; local production secrets intentionally absent from the ZIP).

`node --check` — **PASS** for the modified JavaScript files.

Bundled APK metadata validation — **PASS** for `public/releases/android/1.0.0/JyyR-Amprem-1.0.0.apk` (package `com.jyystore.jyyramprem`, version `1.0.0`, code `1`, min SDK `24`, target SDK `35`, size `9229016`, SHA-256 `81fb4e7c46867b13bf1848b110c91fd0ebb4d0aa5b881331f7128e9bb085b69b`).

## Source comparison

The supplied `jyyramprem_github.zip` matches the uploaded project snapshot except for four source additions in the GitHub snapshot: `FINAL_AUDIT_REPORT.md`, `lib/apk-manifest.js`, `public/js/apk-metadata.js`, and `supabase/migrations/20260902210000_app_release_integrity_hardening_v2.sql`. The project snapshot is internally consistent after the fixes above. A direct live GitHub fetch was unavailable in this audit environment, so no unsupported claim of byte-for-byte remote equality is made.

## Deployment readiness

**CODE AUDIT: PASS.** The screenshot's concrete upload failure is fixed in the supplied source. The production site still needs a real deployment of this corrected source and one authenticated Owner smoke test with the actual APK before publishing a new production release.
