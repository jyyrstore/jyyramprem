-- Owner accounts have implicit portal access. Member accounts still require
-- an active, unexpired portal access grant. This prevents the Owner from being
-- blocked by the same token gate they administer.

BEGIN;

CREATE OR REPLACE FUNCTION public.portal_has_access(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_owner(p_user_id)
      OR EXISTS (
        SELECT 1
        FROM public.portal_access_grants g
        JOIN public.portal_access_tokens t ON t.id = g.token_id
        WHERE g.user_id = p_user_id
          AND t.status = 'active'
          AND t.expires_at > now()
          AND g.expires_at > now()
      );
$$;

REVOKE ALL ON FUNCTION public.portal_has_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_has_access(uuid) TO authenticated;

COMMIT;
