-- Jyy\'R Amprem app release integrity hardening.
-- Existing releases are preserved; this migration only adds constraints/trigger hardening.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.app_releases'::regclass
      AND conname = 'app_releases_app_platform_channel_version_code_key'
  ) THEN
    ALTER TABLE public.app_releases
      ADD CONSTRAINT app_releases_app_platform_channel_version_code_key
      UNIQUE (app_key, platform, release_channel, version_code);
  END IF;
END $$;

ALTER TABLE public.app_releases
  DROP CONSTRAINT IF EXISTS app_releases_published_at_check;

ALTER TABLE public.app_releases
  ADD CONSTRAINT app_releases_published_at_check
  CHECK (status <> 'published' OR published_at IS NOT NULL);

CREATE OR REPLACE FUNCTION public.set_app_releases_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  ELSIF NEW.status <> 'published' THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_releases_set_updated_at ON public.app_releases;
CREATE TRIGGER app_releases_set_updated_at
BEFORE UPDATE ON public.app_releases
FOR EACH ROW EXECUTE FUNCTION public.set_app_releases_updated_at();
