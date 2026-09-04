-- Production verification for the canonical 1-token-1-user contract.
-- Run with a privileged database role.

DO $$
DECLARE
  v_count bigint;
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='portal_access_tokens' AND column_name='redemption_expires_at') THEN
    RAISE EXCEPTION 'Missing portal_access_tokens.redemption_expires_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='portal_access_grants' AND column_name='access_expires_at') THEN
    RAISE EXCEPTION 'Missing portal_access_grants.access_expires_at';
  END IF;

  SELECT count(*) INTO v_count FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='owner_create_portal_token';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Expected exactly one owner_create_portal_token overload; found %', v_count; END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='portal_verify_token'
    AND pg_get_function_identity_arguments(p.oid)='uuid, text';

  IF v_def IS NULL THEN RAISE EXCEPTION 'Canonical portal_verify_token(uuid,text) missing'; END IF;
  IF position('FOR UPDATE' IN upper(v_def)) = 0 THEN RAISE EXCEPTION 'portal_verify_token lacks row locking'; END IF;
  IF position('assigned_user_id' IN v_def) = 0 THEN RAISE EXCEPTION 'portal_verify_token does not assign user'; END IF;
  IF position('interval ''15 days''' IN v_def) = 0 OR position('interval ''30 days''' IN v_def) = 0 THEN RAISE EXCEPTION 'Duration modes missing from redemption logic'; END IF;
  IF position('interval ''24 hours''' IN v_def) = 0 THEN RAISE EXCEPTION '24-hour redemption boundary missing'; END IF;
  IF position('grant_expires_at' IN v_def) > 0 OR position('reusable' IN lower(v_def)) > 0 THEN RAISE EXCEPTION 'Legacy reusable/fixed-grant semantics remain'; END IF;

  SELECT count(*) INTO v_count
  FROM public.portal_access_tokens t
  WHERE t.status='active' AND (t.assigned_user_id IS NOT NULL OR t.used_at IS NOT NULL);
  IF v_count > 0 THEN RAISE EXCEPTION 'Invariant violation: active token already assigned/used (% rows)', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM public.portal_access_tokens t
  JOIN public.portal_access_grants g ON g.token_id=t.id
  WHERE t.status='used' AND t.assigned_user_id IS NOT NULL AND g.user_id <> t.assigned_user_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'Invariant violation: used token grant belongs to a different user (% rows)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.portal_access_tokens t
  WHERE t.status='active' AND t.assigned_user_id IS NULL AND t.used_at IS NULL AND t.redemption_expires_at <= now();
  IF v_count > 0 THEN RAISE EXCEPTION 'Expired available tokens were not materialized as expired (% rows)', v_count; END IF;
END;
$$;

SELECT 'PASS: canonical token contract verified' AS result;
