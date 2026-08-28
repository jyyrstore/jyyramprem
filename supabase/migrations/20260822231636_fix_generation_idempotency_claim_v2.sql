-- Fix idempotency claim: check the idempotency INSERT row count, not the
-- preceding account INSERT. Serialize the same key to prevent duplicate work.
CREATE OR REPLACE FUNCTION public.claim_generation_request(
  p_user_id uuid,
  p_idempotency_hash text
)
RETURNS TABLE (is_new boolean, state text, account_id uuid, http_status integer, response_body jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_inserted integer;
BEGIN
  IF p_user_id IS NULL OR p_idempotency_hash IS NULL OR length(p_idempotency_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid idempotency claim';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('am-idempotency:' || p_user_id::text || ':' || p_idempotency_hash, 0));
  INSERT INTO public.am_generation_idempotency (user_id,idempotency_hash,account_id,state)
  VALUES (p_user_id,p_idempotency_hash,NULL,'pending')
  ON CONFLICT (user_id,idempotency_hash) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    INSERT INTO public.am_generated_accounts (user_id,status,provider_response)
    VALUES (p_user_id,'pending','{}'::jsonb)
    RETURNING id INTO v_account_id;
    UPDATE public.am_generation_idempotency
    SET account_id=v_account_id,updated_at=now()
    WHERE user_id=p_user_id AND idempotency_hash=p_idempotency_hash;
    RETURN QUERY SELECT true,'pending'::text,v_account_id,NULL::integer,'{}'::jsonb;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT false,i.state,i.account_id,i.http_status,i.response_body
  FROM public.am_generation_idempotency i
  WHERE i.user_id=p_user_id AND i.idempotency_hash=p_idempotency_hash;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_generation_request(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_generation_request(uuid,text) TO service_role;
