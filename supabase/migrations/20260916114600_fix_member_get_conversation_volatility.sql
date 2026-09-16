-- member_get_conversation performs an UPDATE (read receipt), so PostgreSQL
-- must classify it as VOLATILE rather than STABLE.
CREATE OR REPLACE FUNCTION public.member_get_conversation(
  p_user_id uuid,
  p_conversation_id uuid,
  p_limit integer,
  p_offset integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_member jsonb;
  v_messages jsonb;
BEGIN
  PERFORM public.assert_member_active(p_user_id);
  SELECT jsonb_build_object(
    'user_id',u.id,
    'email',u.email,
    'display_name',coalesce(m.display_name,split_part(coalesce(u.email,''),'@',1)),
    'status',coalesce(m.status,'active')
  ) INTO v_member
  FROM public.owner_conversations c
  JOIN auth.users u ON u.id=c.created_by
  LEFT JOIN public.member_profiles m ON m.user_id=c.created_by
  WHERE c.id=p_conversation_id AND c.member_user_id=p_user_id;
  IF v_member IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sent_at),'[]'::jsonb)
  INTO v_messages
  FROM (
    SELECT id,conversation_id,sender_user_id,recipient_user_id,body,sent_at,read_at
    FROM public.owner_messages
    WHERE conversation_id=p_conversation_id
    ORDER BY sent_at ASC
    LIMIT p_limit OFFSET p_offset
  ) x;
  UPDATE public.owner_messages
  SET read_at=coalesce(read_at,now())
  WHERE conversation_id=p_conversation_id
    AND recipient_user_id=p_user_id
    AND read_at IS NULL;
  RETURN jsonb_build_object('member',v_member,'messages',v_messages,'limit',p_limit,'offset',p_offset);
END;
$function$;
