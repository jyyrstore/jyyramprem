ALTER TABLE public.am_generated_accounts
  ADD CONSTRAINT am_generated_accounts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.am_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_am_generated_accounts_updated_at ON public.am_generated_accounts;
CREATE TRIGGER trg_am_generated_accounts_updated_at
BEFORE UPDATE ON public.am_generated_accounts
FOR EACH ROW
EXECUTE FUNCTION public.am_touch_updated_at();

DROP POLICY IF EXISTS "Users can view own generated accounts" ON public.am_generated_accounts;
CREATE POLICY "Users can view own generated accounts"
ON public.am_generated_accounts
FOR SELECT TO authenticated
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own generation logs" ON public.am_generation_logs;
CREATE POLICY "Users can view own generation logs"
ON public.am_generation_logs
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.am_generated_accounts a
  WHERE a.id = account_id AND a.user_id = (select auth.uid())
));

DROP POLICY IF EXISTS "No direct client access to global usage" ON public.am_api_usage;
CREATE POLICY "No direct client access to global usage"
ON public.am_api_usage
FOR ALL TO authenticated
USING (false) WITH CHECK (false);

REVOKE EXECUTE ON FUNCTION public.am_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_api_usage(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_api_usage_result(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_api_usage(date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_api_usage_result(date, boolean) TO service_role;
