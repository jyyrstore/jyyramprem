# JYYR Amprem — App Release Source Package

This repository contains the source code for the JYYR Amprem account portal and App Center release management flow.

## Release artifacts

APK binaries are not bundled in this source package. Release APK files are stored and finalized through the configured server-side release flow and Supabase Storage integration.

The App Center reads release metadata from the existing API and uses the configured public release endpoints for download and integrity information.
