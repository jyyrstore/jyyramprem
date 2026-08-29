CREATE OR REPLACE FUNCTION public.member_status(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT m.status FROM public.member_profiles m WHERE m.user_id = p_user_id), 'active');
$$;

CREATE OR REPLACE FUNCTION public.assert_member_active(p_user_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT coalesce(m.status,'active') INTO v_status FROM public.member_profiles m WHERE m.user_id=p_user_id;
  IF v_status='banned' THEN RAISE EXCEPTION 'Member account is banned'; END IF;
  IF v_status='suspended' THEN RAISE EXCEPTION 'Member account is suspended'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_has_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT m.status='active' FROM public.member_profiles m WHERE m.user_id=p_user_id), true)
  AND EXISTS (SELECT 1 FROM public.portal_access_grants g JOIN public.portal_access_tokens t ON t.id=g.token_id WHERE g.user_id=p_user_id AND t.status<>'revoked' AND t.expires_at>now() AND g.expires_at>now());
$$;

DROP FUNCTION public.member_list_conversations(uuid,integer,integer);
DROP FUNCTION public.member_get_conversation(uuid,uuid,integer,integer);
DROP FUNCTION public.member_send_message(uuid,uuid,text);
DROP FUNCTION public.member_mark_messages_read(uuid,uuid);
DROP FUNCTION public.member_list_notifications(uuid,integer,integer);
DROP FUNCTION public.member_mark_notification_read(uuid,uuid);

CREATE FUNCTION public.member_list_conversations(p_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint;
BEGIN
  PERFORM public.assert_member_active(p_user_id);
  SELECT count(*) INTO v_total FROM public.owner_conversations WHERE member_user_id=p_user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC),'[]'::jsonb) INTO v_rows FROM (SELECT c.id conversation_id,c.member_user_id,c.status,c.updated_at,c.last_message_at,(SELECT om.body FROM public.owner_messages om WHERE om.conversation_id=c.id ORDER BY om.sent_at DESC LIMIT 1) last_message,(SELECT count(*) FROM public.owner_messages om WHERE om.conversation_id=c.id AND om.recipient_user_id=p_user_id AND om.read_at IS NULL) unread_count FROM public.owner_conversations c WHERE c.member_user_id=p_user_id ORDER BY c.updated_at DESC LIMIT p_limit OFFSET p_offset) x;
  RETURN jsonb_build_object('conversations',v_rows,'total',v_total,'limit',p_limit,'offset',p_offset);
END; $$;

CREATE FUNCTION public.member_get_conversation(p_user_id uuid,p_conversation_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_member jsonb; v_messages jsonb;
BEGIN
  PERFORM public.assert_member_active(p_user_id);
  SELECT jsonb_build_object('user_id',u.id,'email',u.email,'display_name',coalesce(m.display_name,split_part(coalesce(u.email,''),'@',1)),'status',coalesce(m.status,'active')) INTO v_member FROM public.owner_conversations c JOIN auth.users u ON u.id=c.created_by LEFT JOIN public.member_profiles m ON m.user_id=c.created_by WHERE c.id=p_conversation_id AND c.member_user_id=p_user_id;
  IF v_member IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sent_at),'[]'::jsonb) INTO v_messages FROM (SELECT id,conversation_id,sender_user_id,recipient_user_id,body,sent_at,read_at FROM public.owner_messages WHERE conversation_id=p_conversation_id ORDER BY sent_at ASC LIMIT p_limit OFFSET p_offset) x;
  UPDATE public.owner_messages SET read_at=coalesce(read_at,now()) WHERE conversation_id=p_conversation_id AND recipient_user_id=p_user_id AND read_at IS NULL;
  RETURN jsonb_build_object('member',v_member,'messages',v_messages,'limit',p_limit,'offset',p_offset);
END; $$;

CREATE FUNCTION public.member_send_message(p_user_id uuid,p_conversation_id uuid,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid; v_status text; v_id uuid; v jsonb;
BEGIN
  PERFORM public.assert_member_active(p_user_id);
  IF length(trim(coalesce(p_body,'')))<1 OR length(p_body)>10000 THEN RAISE EXCEPTION 'Invalid message'; END IF;
  SELECT created_by,status INTO v_owner,v_status FROM public.owner_conversations WHERE id=p_conversation_id AND member_user_id=p_user_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF v_status='closed' THEN RAISE EXCEPTION 'Conversation is closed'; END IF;
  INSERT INTO public.owner_messages(conversation_id,sender_user_id,recipient_user_id,body) VALUES(p_conversation_id,p_user_id,v_owner,trim(p_body)) RETURNING id INTO v_id;
  UPDATE public.owner_conversations SET last_message_at=now(),updated_at=now() WHERE id=p_conversation_id;
  INSERT INTO public.member_notifications(user_id,title,body,message_id) VALUES(v_owner,'Pesan dari Member',trim(p_body),v_id);
  SELECT to_jsonb(m) INTO v FROM public.owner_messages m WHERE m.id=v_id; RETURN v;
END; $$;

CREATE FUNCTION public.member_mark_messages_read(p_user_id uuid,p_conversation_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.assert_member_active(p_user_id);
  UPDATE public.owner_messages SET read_at=coalesce(read_at,now()) WHERE conversation_id=p_conversation_id AND recipient_user_id=p_user_id AND read_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END; $$;

CREATE FUNCTION public.member_list_notifications(p_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint; v_unread bigint;
BEGIN
  PERFORM public.assert_member_active(p_user_id);
  SELECT count(*) INTO v_total FROM public.member_notifications WHERE user_id=p_user_id;
  SELECT count(*) INTO v_unread FROM public.member_notifications WHERE user_id=p_user_id AND read_at IS NULL;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) INTO v_rows FROM (SELECT * FROM public.member_notifications WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) x;
  RETURN jsonb_build_object('notifications',v_rows,'total',v_total,'unread',v_unread,'limit',p_limit,'offset',p_offset);
END; $$;

CREATE FUNCTION public.member_mark_notification_read(p_user_id uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.assert_member_active(p_user_id);
  UPDATE public.member_notifications SET read_at=coalesce(read_at,now()) WHERE id=p_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification not found'; END IF;
  SELECT to_jsonb(n) INTO v FROM public.member_notifications n WHERE n.id=p_id; RETURN v;
END; $$;

REVOKE ALL ON FUNCTION public.member_status(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assert_member_active(uuid) FROM PUBLIC,anon,authenticated;
