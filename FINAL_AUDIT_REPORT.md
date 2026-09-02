# Jyy'R Amprem — Final Release Integrity Audit

Date: 2026-09-02

## Implemented

- APK CREATE flow no longer asks Owner to type Version or Version Code.
- APK selection reads `versionName`, `versionCode`, package name, min SDK and target SDK from `AndroidManifest.xml`.
- Browser computes SHA-256 and reads actual File Size for immediate UI feedback.
- Browser metadata is explicitly non-authoritative.
- Upload uses the signed Supabase Storage URL with the APK as the raw request body; the old multipart/FormData upload path is removed.
- Server downloads the uploaded APK back from Supabase Storage before creating a release.
- Server recomputes binary size and SHA-256, parses AndroidManifest.xml, validates package, versionName, versionCode, minSdk and targetSdk, and uses those verified values for the release row.
- Package is hard-required to `com.jyystore.jyyramprem`.
- New releases default to Stable, Mandatory Update OFF, Published.
- Minimum Version defaults to the earliest published Stable release; if none exists, the new APK version is used.
- CREATE and EDIT are controlled by explicit editor mode state.
- EDIT cannot alter binary-derived Version, Version Code, File Size, SHA-256, Package Name, Minimum SDK or Target SDK.
- Release success uses one primary top notification path.
- JYYRNotify now suppresses identical notifications within a short interval and guards close/timer execution against repeated calls.
- Supabase integrity hardening was applied live to project `jfjbdenqepaagxfysaar` without changing or deleting existing releases.
- Added unique `(app_key, platform, release_channel, version_code)` protection and the published-at integrity check.
- Existing production releases were preserved: 1.0.0/code 1 and 1.0.1/code 2.

## Verified APK in package

- Package: `com.jyystore.jyyramprem`
- Version: `1.0.0`
- Version Code: `1`
- Minimum SDK: `24`
- Target SDK: `35`
- File size: `9,229,016` bytes
- SHA-256: `81fb4e7c46867b13bf1848b110c91fd0ebb4d0aa5b881331f7128e9bb085b69b`

## Test result

`npm test` passed completely after the changes.

The runtime verification reports local Supabase environment variables as not configured because the ZIP intentionally contains no production `.env`; live Supabase integrity was verified separately against project `jfjbdenqepaagxfysaar`.

## Production comparison

Vercel project `jyyramprem` is connected to GitHub repository `jyyrstore/jyyramprem`. The latest production deployment observed during this audit was READY and corresponded to the earlier commit `0efcc4aac17b6de58b988805d32199bc6449c94f` (`fix: make app release editor mode explicit`). The corrected files in this package are newer local changes and therefore require the corrected source to be committed/deployed before production can be considered fully synchronized with this package.

Historical Vercel runtime errors were also inspected. The reported errors were from earlier deployments (SMTP/provider configuration and older RPC permission issues); they are not evidence that the new APK release code failed. Production deployment itself was READY at audit time.

## Important deployment note

The corrected source package is ready. This audit did not claim a production deployment of these local ZIP changes because the available Vercel deploy action could not accept the local filesystem payload in this session, and the GitHub connector could not read the private repository contents. No production release was altered by the code audit.
