# Jyy'R Amprem — App Release Distribution

This package adds the website-side Android release center and Owner release management.

## Public endpoints

- `/app` → App Center
- `/api/app/latest` → latest published stable release
- `/api/app/releases` → published release history

## Owner release flow

Owner Panel → App Release → choose APK → choose version/version code → upload → publish.
The server issues a Supabase signed upload URL, the browser uploads the APK, computes SHA-256, and stores release metadata in `public.app_releases`.

## Release artifact storage

APK binaries are not bundled in this source package. The Owner Release Center uploads APK files to the configured Supabase Storage bucket and stores verified metadata in `public.app_releases`. The App Center reads the current published release through `/api/app/latest`.

This keeps the source repository independent of large binary release artifacts and avoids claiming that a local APK exists when the release binary is stored remotely.

## Verification

`npm test` passes all configured suites, including the app-release contract.

## Native Android update checker

The supplied APK is a binary WebView wrapper and the Android source project was not supplied. Therefore this package does not modify the binary APK or claim a rebuilt native updater. The existing APK does, however, load the website, so the new App Center and release information are available through the same origin.
