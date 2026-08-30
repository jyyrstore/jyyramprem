-- App release distribution schema; already applied to production project jfjbdenqepaagxfysaar.
create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  app_key text not null default 'jyyramprem',
  platform text not null default 'android' check (platform in ('android')),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$'),
  version_code integer not null check (version_code >= 1),
  title text not null default 'Jyy''R Amprem',
  changelog text[] not null default '{}'::text[],
  download_url text not null,
  storage_path text,
  file_name text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[A-Fa-f0-9]{64}$'),
  min_supported_version text check (min_supported_version is null or min_supported_version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$'),
  mandatory_update boolean not null default false,
  release_channel text not null default 'stable' check (release_channel in ('stable','beta')),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_key, platform, version, release_channel)
);
create index if not exists app_releases_latest_idx on public.app_releases (app_key, platform, release_channel, status, version_code desc, published_at desc);
alter table public.app_releases enable row level security;
grant select on public.app_releases to anon, authenticated;
grant insert, update, delete on public.app_releases to authenticated;
drop policy if exists "Published app releases are public" on public.app_releases;
create policy "Published app releases are public" on public.app_releases for select to anon, authenticated using (status = 'published');
drop policy if exists "Owners manage app releases" on public.app_releases;
create policy "Owners manage app releases" on public.app_releases for all to authenticated using (public.is_owner((select auth.uid()))) with check (public.is_owner((select auth.uid())));
