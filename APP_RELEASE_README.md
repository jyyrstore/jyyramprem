# Jyy'R Amprem — App Release Distribution

This package adds the website-side Android release center and Owner release management.

## Public endpoints

- `/app` → App Center
- `/app.html` → App Center page
- `/api/app/latest` → latest published stable release
- `/api/app/releases` → published release history

## Owner release flow

Owner Panel → App Release → choose APK → choose version/version code → upload → publish.
The server issues a Supabase signed upload URL, the browser uploads the APK, computes SHA-256, and stores release metadata in `public.app_releases`.

## Current bundled release

- Version: 1.0.0
- Version code: 1
- File: `public/releases/android/1.0.0/JyyR-Amprem-1.0.0.apk`
- Size: 9,229,016 bytes
- SHA-256: `81fb4e7c46867b13bf1848b110c91fd0ebb4d0aa5b881331f7128e9bb085b69b`

## Verification

`npm test` passes all configured suites, including the app-release contract.

## Native Android update checker

The supplied APK is a binary WebView wrapper and the Android source project was not supplied. Therefore this package does not modify the binary APK or claim a rebuilt native updater. The existing APK does, however, load the website, so the new App Center and release information are available through the same origin.
