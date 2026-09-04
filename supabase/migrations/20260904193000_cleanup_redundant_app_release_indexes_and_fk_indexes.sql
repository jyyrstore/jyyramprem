-- Keep the constraint-backed unique index as the single source of truth for
-- (app_key, platform, release_channel, version_code); remove redundant copies.
drop index if exists public.app_releases_unique_version_code_channel_idx;
drop index if exists public.app_releases_version_code_uidx;

-- Cover foreign keys used by ownership/revocation/audit relationships.
create index if not exists app_releases_created_by_idx
  on public.app_releases(created_by);

create index if not exists portal_access_tokens_created_by_idx
  on public.portal_access_tokens(created_by);

create index if not exists portal_access_tokens_revoked_by_idx
  on public.portal_access_tokens(revoked_by);

create index if not exists portal_token_requests_assigned_by_idx
  on public.portal_token_requests(assigned_by);

create index if not exists portal_token_requests_resolved_by_idx
  on public.portal_token_requests(resolved_by);

-- Keep exactly one timestamp trigger; the canonical source-package trigger is app_releases_set_updated_at.
drop trigger if exists trg_app_releases_updated_at on public.app_releases;
