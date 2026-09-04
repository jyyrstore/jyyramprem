BEGIN;
DROP FUNCTION IF EXISTS public.owner_create_portal_token(uuid, text, timestamptz, text);
REVOKE ALL ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_create_portal_token(uuid, text, text, text, timestamptz, text, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
