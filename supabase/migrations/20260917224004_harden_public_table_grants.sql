-- Remove direct client table privileges that are not required by the application.
-- RLS does not protect TRUNCATE, so this explicitly removes destructive DDL
-- privileges from anon/authenticated while preserving public release SELECT.
BEGIN;

REVOKE ALL ON TABLE public.am_email_verifications FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.app_releases
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_releases TO anon, authenticated;

COMMIT;
