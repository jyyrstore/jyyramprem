# UI Protection Changelog — 2026-08-26

UI-only change. No application/API/Auth/DB/provider/quota logic was modified.

## Added
- `public/js/ui-protection.js`

## Modified
- `public/css/common.css`
- `public/html/login.html`
- `public/html/index.html`
- `public/html/owner.html`
- `public/html/dashboard.html`
- `public/html/setting.html`
- `public/html/reset-password.html`
- `public/html/home.html`

## Limit
Browser-side protection can deter normal save/drag/context-menu actions and remove tap highlight, but it cannot make browser-delivered assets cryptographically impossible to obtain (for example via DevTools, cache, screenshots, or network inspection).
