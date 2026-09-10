# Navigation Active Dock — Reference Match Revision

Base: Project Alight Motion V4.2 NAV_ACTIVE_DOCK_READY

Only the navigation styling file is included in this package.

## Changes
- Rebuilt the active navigation cradle as a full raised circular form.
- Moved the active icon downward into the cradle, matching the supplied reference composition.
- Kept the lower half of the cradle visually integrated into the charcoal rail.
- Preserved the purple rail edge and active purple glow.
- Kept inactive icons inside the rail with their existing spacing.
- Preserved accessibility labels and `aria-current` behavior.
- No API, auth, database, quota, provider, or business logic changes.


## 2026-09-10 — Direct redeem Owner tokens
- Owner-generated portal tokens use `JYYR` + 8 random uppercase hex characters (12 characters total).
- Newly generated tokens can be redeemed immediately without publication.
- JYY'R Token publication remains optional and controls distribution visibility only.
- Unpublishing no longer affects direct redemption eligibility.
