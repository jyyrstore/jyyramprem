-- Owner Runtime Contract V1
-- Reconciles the local migration set with the production Owner/Member API contract.
-- Idempotent: safe to run against databases that already contain these objects.

BEGIN;

CREATE TABLE IF NOT EXISTS public.owner_lock (
  id boolean PRIMARY KEY DEFAULT true,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','banned')),
  status_reason text,
  suspended_at timestamptz,
  banned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL CHECK (new_status IN ('active','suspended','banned')),
  reason text,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled','failed')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  recipient_filter text NOT NULL DEFAULT 'all' CHECK (recipient_filter IN ('all','active','suspended','banned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(member_user_id)
);

CREATE TABLE IF NOT EXISTS public.owner_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.owner_conversations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 10000),
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_faq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_help_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  content text NOT NULL,
  category text,
  sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_login_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  success boolean NOT NULL DEFAULT true,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_system_settings (
  id boolean PRIMARY KEY DEFAULT true,
  maintenance_enabled boolean NOT NULL DEFAULT false,
  maintenance_message text NOT NULL DEFAULT 'Jyy''R Amprem Sedang Maintenance',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  broadcast_id uuid REFERENCES public.owner_broadcasts(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.owner_messages(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.owner_system_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS owner_lock_owner_user_id_idx ON public.owner_lock(owner_user_id);
CREATE INDEX IF NOT EXISTS member_profiles_status_idx ON public.member_profiles(status);
CREATE INDEX IF NOT EXISTS member_profiles_updated_at_idx ON public.member_profiles(updated_at DESC);
CREATE INDEX IF NOT EXISTS member_status_events_user_created_idx ON public.member_status_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS owner_broadcasts_created_at_idx ON public.owner_broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS owner_conversations_updated_at_idx ON public.owner_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS owner_messages_conversation_sent_idx ON public.owner_messages(conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS owner_messages_recipient_unread_idx ON public.owner_messages(recipient_user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS owner_faq_sort_idx ON public.owner_faq(sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS owner_help_sort_idx ON public.owner_help_articles(sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS owner_login_activity_created_idx ON public.owner_login_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS member_notifications_user_created_idx ON public.member_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS member_notifications_unread_idx ON public.member_notifications(user_id, read_at) WHERE read_at IS NULL;

ALTER TABLE public.owner_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_faq ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_help_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_login_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.owner_lock, public.member_profiles, public.member_status_events,
  public.owner_broadcasts, public.owner_conversations, public.owner_messages,
  public.owner_faq, public.owner_help_articles, public.owner_login_activity,
  public.owner_system_settings, public.member_notifications FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_owner(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.owner_lock WHERE id = true AND owner_user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.claim_initial_owner()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT owner_user_id INTO v_owner FROM public.owner_lock WHERE id = true;
  IF v_owner IS NOT NULL THEN RETURN v_owner = v_uid; END IF;
  INSERT INTO public.owner_lock(id, owner_user_id) VALUES(true, v_uid) ON CONFLICT(id) DO NOTHING;
  SELECT owner_user_id INTO v_owner FROM public.owner_lock WHERE id = true;
  RETURN v_owner = v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_initial_owner(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Invalid user id'; END IF;
  SELECT owner_user_id INTO v_owner FROM public.owner_lock WHERE id = true;
  IF v_owner IS NOT NULL THEN RETURN v_owner = p_user_id; END IF;
  INSERT INTO public.owner_lock(id, owner_user_id) VALUES(true, p_user_id) ON CONFLICT(id) DO NOTHING;
  SELECT owner_user_id INTO v_owner FROM public.owner_lock WHERE id = true;
  RETURN v_owner = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_owner()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_members(p_owner_user_id uuid,p_limit integer,p_offset integer,p_search text,p_status text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_members jsonb; v_total bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_limit IS NULL OR p_limit < 0 OR p_offset IS NULL OR p_offset < 0 THEN RAISE EXCEPTION 'Invalid pagination'; END IF;
  INSERT INTO public.member_profiles(user_id) SELECT id FROM auth.users ON CONFLICT(user_id) DO NOTHING;
  SELECT count(*) INTO v_total FROM auth.users u LEFT JOIN public.member_profiles m ON m.user_id=u.id
    WHERE u.id <> p_owner_user_id AND (p_status IS NULL OR coalesce(m.status,'active')=p_status)
      AND (p_search IS NULL OR coalesce(m.display_name,'') ILIKE '%'||p_search||'%' OR coalesce(u.email,'') ILIKE '%'||p_search||'%');
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) INTO v_members FROM (
    SELECT u.id AS user_id,u.email,coalesce(m.display_name,split_part(coalesce(u.email,''),'@',1)) AS display_name,
      coalesce(m.notes,'') AS notes,coalesce(m.status,'active') AS status,m.status_reason,m.suspended_at,m.banned_at,u.created_at,u.last_sign_in_at
    FROM auth.users u LEFT JOIN public.member_profiles m ON m.user_id=u.id
    WHERE u.id <> p_owner_user_id AND (p_status IS NULL OR coalesce(m.status,'active')=p_status)
      AND (p_search IS NULL OR coalesce(m.display_name,'') ILIKE '%'||p_search||'%' OR coalesce(u.email,'') ILIKE '%'||p_search||'%')
    ORDER BY u.created_at DESC LIMIT p_limit OFFSET p_offset
  ) x;
  RETURN jsonb_build_object('members',v_members,'total',v_total,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_member(p_owner_user_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_user_id IS NULL OR p_user_id=p_owner_user_id THEN RAISE EXCEPTION 'Member not found'; END IF;
  INSERT INTO public.member_profiles(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
  SELECT jsonb_build_object('user_id',u.id,'email',u.email,'display_name',coalesce(m.display_name,split_part(coalesce(u.email,''),'@',1)),'notes',m.notes,'status',coalesce(m.status,'active'),'status_reason',m.status_reason,'suspended_at',m.suspended_at,'banned_at',m.banned_at,'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at) INTO v
  FROM auth.users u LEFT JOIN public.member_profiles m ON m.user_id=u.id WHERE u.id=p_user_id;
  IF v IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_member_profile(p_owner_user_id uuid,p_user_id uuid,p_display_name text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_user_id=p_owner_user_id THEN RAISE EXCEPTION 'Invalid member'; END IF;
  INSERT INTO public.member_profiles(user_id,display_name,notes) VALUES(p_user_id,p_display_name,p_notes)
  ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,notes=EXCLUDED.notes,updated_at=now();
  RETURN public.owner_get_member(p_owner_user_id,p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_member_status(p_owner_user_id uuid,p_user_id uuid,p_new_status text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text; v_now timestamptz:=now();
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_user_id IS NULL OR p_user_id=p_owner_user_id THEN RAISE EXCEPTION 'Invalid member'; END IF;
  IF p_new_status NOT IN ('active','suspended','banned') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  INSERT INTO public.member_profiles(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
  SELECT status INTO v_old FROM public.member_profiles WHERE user_id=p_user_id;
  IF v_old=p_new_status THEN RETURN public.owner_get_member(p_owner_user_id,p_user_id); END IF;
  UPDATE public.member_profiles SET status=p_new_status,status_reason=p_reason,suspended_at=CASE WHEN p_new_status='suspended' THEN v_now ELSE NULL END,banned_at=CASE WHEN p_new_status='banned' THEN v_now ELSE NULL END,updated_at=v_now WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  INSERT INTO public.member_status_events(user_id,old_status,new_status,reason,changed_by) VALUES(p_user_id,v_old,p_new_status,p_reason,p_owner_user_id);
  RETURN public.owner_get_member(p_owner_user_id,p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_broadcasts(p_owner_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT count(*) INTO v_total FROM public.owner_broadcasts;
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC),'[]'::jsonb) INTO v_rows FROM (SELECT * FROM public.owner_broadcasts ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) b;
  RETURN jsonb_build_object('broadcasts',v_rows,'total',v_total,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_broadcast(p_owner_user_id uuid,p_broadcast_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT to_jsonb(b) INTO v FROM public.owner_broadcasts b WHERE b.id=p_broadcast_id;
  IF v IS NULL THEN RAISE EXCEPTION 'Broadcast not found'; END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_create_broadcast(p_owner_user_id uuid,p_title text,p_message text,p_status text,p_scheduled_at timestamptz,p_recipient_filter text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb; v_id uuid;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF length(trim(coalesce(p_title,'')))<1 OR length(p_title)>160 OR length(trim(coalesce(p_message,'')))<1 OR length(p_message)>10000 THEN RAISE EXCEPTION 'Invalid broadcast'; END IF;
  IF p_status NOT IN ('draft','scheduled') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF p_recipient_filter NOT IN ('all','active','suspended','banned') THEN RAISE EXCEPTION 'Invalid recipient filter'; END IF;
  IF p_status='scheduled' AND p_scheduled_at IS NULL THEN RAISE EXCEPTION 'Scheduled broadcast requires scheduled time'; END IF;
  IF p_status='scheduled' AND p_scheduled_at <= now() THEN RAISE EXCEPTION 'Scheduled time must be in the future'; END IF;
  INSERT INTO public.owner_broadcasts(created_by,title,message,status,scheduled_at,recipient_filter) VALUES(p_owner_user_id,trim(p_title),trim(p_message),p_status,p_scheduled_at,p_recipient_filter) RETURNING id INTO v_id;
  RETURN public.owner_get_broadcast(p_owner_user_id,v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_broadcast(p_owner_user_id uuid,p_broadcast_id uuid,p_title text,p_message text,p_status text,p_scheduled_at timestamptz,p_recipient_filter text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT status INTO v_old FROM public.owner_broadcasts WHERE id=p_broadcast_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Broadcast not found'; END IF;
  IF v_old NOT IN ('draft','scheduled') THEN RAISE EXCEPTION 'Only draft or scheduled broadcasts can be edited'; END IF;
  IF p_status NOT IN ('draft','scheduled') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF p_recipient_filter NOT IN ('all','active','suspended','banned') THEN RAISE EXCEPTION 'Invalid recipient filter'; END IF;
  IF p_status='scheduled' AND (p_scheduled_at IS NULL OR p_scheduled_at<=now()) THEN RAISE EXCEPTION 'Scheduled time must be in the future'; END IF;
  UPDATE public.owner_broadcasts SET title=trim(p_title),message=trim(p_message),status=p_status,scheduled_at=p_scheduled_at,recipient_filter=p_recipient_filter,updated_at=now() WHERE id=p_broadcast_id;
  RETURN public.owner_get_broadcast(p_owner_user_id,p_broadcast_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_delete_broadcast(p_owner_user_id uuid,p_broadcast_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT status INTO v_status FROM public.owner_broadcasts WHERE id=p_broadcast_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Broadcast not found'; END IF;
  IF v_status NOT IN ('draft','cancelled','failed') THEN RAISE EXCEPTION 'Only draft, cancelled or failed broadcasts can be deleted'; END IF;
  DELETE FROM public.owner_broadcasts WHERE id=p_broadcast_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_create_conversation(p_owner_user_id uuid,p_member_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_status text; v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF p_member_user_id=p_owner_user_id THEN RAISE EXCEPTION 'Owner cannot create a member conversation with self'; END IF;
  INSERT INTO public.member_profiles(user_id) VALUES(p_member_user_id) ON CONFLICT(user_id) DO NOTHING;
  SELECT status INTO v_status FROM public.member_profiles WHERE user_id=p_member_user_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;
  INSERT INTO public.owner_conversations(member_user_id,created_by,status) VALUES(p_member_user_id,p_owner_user_id,'open') ON CONFLICT(member_user_id) DO UPDATE SET updated_at=now() RETURNING id INTO v_id;
  SELECT to_jsonb(c) INTO v FROM public.owner_conversations c WHERE c.id=v_id;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_conversations(p_owner_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT count(*) INTO v_total FROM public.owner_conversations;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC),'[]'::jsonb) INTO v_rows FROM (
    SELECT c.id conversation_id,c.member_user_id,u.email,coalesce(m.display_name,split_part(coalesce(u.email,''),'@',1)) display_name,coalesce(m.status,'active') status,c.updated_at,c.last_message_at,
      (SELECT om.body FROM public.owner_messages om WHERE om.conversation_id=c.id ORDER BY om.sent_at DESC LIMIT 1) last_message,
      (SELECT count(*) FROM public.owner_messages om WHERE om.conversation_id=c.id AND om.recipient_user_id=p_owner_user_id AND om.read_at IS NULL) unread_count
    FROM public.owner_conversations c JOIN auth.users u ON u.id=c.member_user_id LEFT JOIN public.member_profiles m ON m.user_id=c.member_user_id
    ORDER BY c.updated_at DESC LIMIT p_limit OFFSET p_offset
  ) x;
  RETURN jsonb_build_object('conversations',v_rows,'total',v_total,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_conversation(p_owner_user_id uuid,p_conversation_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_member jsonb; v_messages jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT jsonb_build_object('user_id',u.id,'email',u.email,'display_name',coalesce(m.display_name,split_part(coalesce(u.email,''),'@',1)),'status',coalesce(m.status,'active')) INTO v_member
  FROM public.owner_conversations c JOIN auth.users u ON u.id=c.member_user_id LEFT JOIN public.member_profiles m ON m.user_id=c.member_user_id WHERE c.id=p_conversation_id;
  IF v_member IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sent_at),'[]'::jsonb) INTO v_messages FROM (SELECT id,conversation_id,sender_user_id,recipient_user_id,body,sent_at,read_at FROM public.owner_messages WHERE conversation_id=p_conversation_id ORDER BY sent_at ASC LIMIT p_limit OFFSET p_offset) x;
  UPDATE public.owner_messages SET read_at=coalesce(read_at,now()) WHERE conversation_id=p_conversation_id AND recipient_user_id=p_owner_user_id AND read_at IS NULL;
  RETURN jsonb_build_object('member',v_member,'messages',v_messages,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_send_message(p_owner_user_id uuid,p_conversation_id uuid,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_member uuid; v_status text; v_id uuid; v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF length(trim(coalesce(p_body,'')))<1 OR length(p_body)>10000 THEN RAISE EXCEPTION 'Invalid message'; END IF;
  SELECT member_user_id,status INTO v_member,v_status FROM public.owner_conversations WHERE id=p_conversation_id;
  IF v_member IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF v_status='closed' THEN RAISE EXCEPTION 'Conversation is closed'; END IF;
  INSERT INTO public.owner_messages(conversation_id,sender_user_id,recipient_user_id,body) VALUES(p_conversation_id,p_owner_user_id,v_member,trim(p_body)) RETURNING id INTO v_id;
  UPDATE public.owner_conversations SET last_message_at=now(),updated_at=now() WHERE id=p_conversation_id;
  INSERT INTO public.member_notifications(user_id,title,body,message_id) VALUES(v_member,'Pesan dari Owner',trim(p_body),v_id);
  SELECT to_jsonb(m) INTO v FROM public.owner_messages m WHERE m.id=v_id;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.member_list_conversations(p_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT count(*) INTO v_total FROM public.owner_conversations WHERE member_user_id=p_user_id;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC),'[]'::jsonb) INTO v_rows FROM (
    SELECT c.id conversation_id,c.member_user_id,c.status,c.updated_at,c.last_message_at,(SELECT om.body FROM public.owner_messages om WHERE om.conversation_id=c.id ORDER BY om.sent_at DESC LIMIT 1) last_message,
      (SELECT count(*) FROM public.owner_messages om WHERE om.conversation_id=c.id AND om.recipient_user_id=p_user_id AND om.read_at IS NULL) unread_count
    FROM public.owner_conversations c WHERE c.member_user_id=p_user_id ORDER BY c.updated_at DESC LIMIT p_limit OFFSET p_offset
  ) x;
  RETURN jsonb_build_object('conversations',v_rows,'total',v_total,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.member_get_conversation(p_user_id uuid,p_conversation_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_member jsonb; v_messages jsonb;
BEGIN
  SELECT jsonb_build_object('user_id',u.id,'email',u.email,'display_name',coalesce(m.display_name,split_part(coalesce(u.email,''),'@',1)),'status',coalesce(m.status,'active')) INTO v_member
  FROM public.owner_conversations c JOIN auth.users u ON u.id=c.created_by LEFT JOIN public.member_profiles m ON m.user_id=c.created_by
  WHERE c.id=p_conversation_id AND c.member_user_id=p_user_id;
  IF v_member IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sent_at),'[]'::jsonb) INTO v_messages FROM (SELECT id,conversation_id,sender_user_id,recipient_user_id,body,sent_at,read_at FROM public.owner_messages WHERE conversation_id=p_conversation_id ORDER BY sent_at ASC LIMIT p_limit OFFSET p_offset) x;
  UPDATE public.owner_messages SET read_at=coalesce(read_at,now()) WHERE conversation_id=p_conversation_id AND recipient_user_id=p_user_id AND read_at IS NULL;
  RETURN jsonb_build_object('member',v_member,'messages',v_messages,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.member_send_message(p_user_id uuid,p_conversation_id uuid,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid; v_status text; v_id uuid; v jsonb;
BEGIN
  IF length(trim(coalesce(p_body,'')))<1 OR length(p_body)>10000 THEN RAISE EXCEPTION 'Invalid message'; END IF;
  SELECT created_by,status INTO v_owner,v_status FROM public.owner_conversations WHERE id=p_conversation_id AND member_user_id=p_user_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF v_status='closed' THEN RAISE EXCEPTION 'Conversation is closed'; END IF;
  INSERT INTO public.owner_messages(conversation_id,sender_user_id,recipient_user_id,body) VALUES(p_conversation_id,p_user_id,v_owner,trim(p_body)) RETURNING id INTO v_id;
  UPDATE public.owner_conversations SET last_message_at=now(),updated_at=now() WHERE id=p_conversation_id;
  INSERT INTO public.member_notifications(user_id,title,body,message_id) VALUES(v_owner,'Pesan dari Member',trim(p_body),v_id);
  SELECT to_jsonb(m) INTO v FROM public.owner_messages m WHERE m.id=v_id;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.member_mark_messages_read(p_user_id uuid,p_conversation_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.owner_messages SET read_at=coalesce(read_at,now()) WHERE conversation_id=p_conversation_id AND recipient_user_id=p_user_id AND read_at IS NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_faq(p_owner_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT count(*) INTO v_total FROM public.owner_faq;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sort_order,x.created_at),'[]'::jsonb) INTO v_rows FROM (SELECT * FROM public.owner_faq ORDER BY sort_order,created_at LIMIT p_limit OFFSET p_offset) x;
  RETURN jsonb_build_object('faq',v_rows,'total',v_total,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_create_faq(p_owner_user_id uuid,p_question text,p_answer text,p_category text,p_sort_order integer,p_published boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF length(trim(coalesce(p_question,'')))<3 OR length(p_question)>500 OR length(trim(coalesce(p_answer,'')))<1 OR length(p_answer)>10000 THEN RAISE EXCEPTION 'Invalid FAQ'; END IF;
  INSERT INTO public.owner_faq(question,answer,category,sort_order,published,created_by) VALUES(trim(p_question),trim(p_answer),p_category,coalesce(p_sort_order,0),coalesce(p_published,true),p_owner_user_id) RETURNING to_jsonb(owner_faq.*) INTO v;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_faq(p_owner_user_id uuid,p_id uuid,p_question text,p_answer text,p_category text,p_sort_order integer,p_published boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  UPDATE public.owner_faq SET question=trim(p_question),answer=trim(p_answer),category=p_category,sort_order=coalesce(p_sort_order,0),published=coalesce(p_published,true),updated_at=now() WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FAQ not found'; END IF;
  SELECT to_jsonb(f) INTO v FROM public.owner_faq f WHERE f.id=p_id; RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_delete_faq(p_owner_user_id uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  DELETE FROM public.owner_faq WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FAQ not found'; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_help(p_owner_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT count(*) INTO v_total FROM public.owner_help_articles;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sort_order,x.created_at),'[]'::jsonb) INTO v_rows FROM (SELECT * FROM public.owner_help_articles ORDER BY sort_order,created_at LIMIT p_limit OFFSET p_offset) x;
  RETURN jsonb_build_object('help',v_rows,'total',v_total,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_create_help(p_owner_user_id uuid,p_title text,p_slug text,p_content text,p_category text,p_sort_order integer,p_published boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF length(trim(coalesce(p_title,'')))<3 OR length(p_title)>200 OR length(trim(coalesce(p_slug,'')))<1 OR length(p_slug)>240 OR length(trim(coalesce(p_content,'')))<1 OR length(p_content)>20000 THEN RAISE EXCEPTION 'Invalid help article'; END IF;
  INSERT INTO public.owner_help_articles(title,slug,content,category,sort_order,published,created_by) VALUES(trim(p_title),lower(trim(p_slug)),trim(p_content),p_category,coalesce(p_sort_order,0),coalesce(p_published,true),p_owner_user_id) RETURNING to_jsonb(owner_help_articles.*) INTO v;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_help(p_owner_user_id uuid,p_id uuid,p_title text,p_slug text,p_content text,p_category text,p_sort_order integer,p_published boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  UPDATE public.owner_help_articles SET title=trim(p_title),slug=lower(trim(p_slug)),content=trim(p_content),category=p_category,sort_order=coalesce(p_sort_order,0),published=coalesce(p_published,true),updated_at=now() WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Help not found'; END IF;
  SELECT to_jsonb(h) INTO v FROM public.owner_help_articles h WHERE h.id=p_id; RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_delete_help(p_owner_user_id uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  DELETE FROM public.owner_help_articles WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Help not found'; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_login_activity(p_owner_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT count(*) INTO v_total FROM public.owner_login_activity;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) INTO v_rows FROM (
    SELECT l.id,l.user_id,l.event,l.success,l.ip_address,l.user_agent,l.created_at,u.email,coalesce(m.display_name,split_part(coalesce(u.email,''),'@',1)) display_name
    FROM public.owner_login_activity l JOIN auth.users u ON u.id=l.user_id LEFT JOIN public.member_profiles m ON m.user_id=l.user_id
    ORDER BY l.created_at DESC LIMIT p_limit OFFSET p_offset
  ) x;
  RETURN jsonb_build_object('activity',v_rows,'total',v_total,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_system_settings(p_owner_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  INSERT INTO public.owner_system_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING;
  SELECT to_jsonb(s) INTO v FROM public.owner_system_settings s WHERE id=true; RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_maintenance(p_owner_user_id uuid,p_enabled boolean,p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  IF length(coalesce(p_message,''))>500 THEN RAISE EXCEPTION 'Message too long'; END IF;
  INSERT INTO public.owner_system_settings(id,maintenance_enabled,maintenance_message,updated_by) VALUES(true,coalesce(p_enabled,false),coalesce(nullif(p_message,''),'Jyy''R Amprem Sedang Maintenance'),p_owner_user_id)
  ON CONFLICT(id) DO UPDATE SET maintenance_enabled=EXCLUDED.maintenance_enabled,maintenance_message=EXCLUDED.maintenance_message,updated_by=p_owner_user_id,updated_at=now();
  SELECT to_jsonb(s) INTO v FROM public.owner_system_settings s WHERE id=true; RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_get_maintenance()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('maintenance_enabled',coalesce(s.maintenance_enabled,false),'maintenance_message',coalesce(s.maintenance_message,''))
  FROM public.owner_system_settings s WHERE s.id=true;
$$;

CREATE OR REPLACE FUNCTION public.member_list_notifications(p_user_id uuid,p_limit integer,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb; v_total bigint; v_unread bigint;
BEGIN
  SELECT count(*) INTO v_total FROM public.member_notifications WHERE user_id=p_user_id;
  SELECT count(*) INTO v_unread FROM public.member_notifications WHERE user_id=p_user_id AND read_at IS NULL;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) INTO v_rows FROM (SELECT * FROM public.member_notifications WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) x;
  RETURN jsonb_build_object('notifications',v_rows,'total',v_total,'unread',v_unread,'limit',p_limit,'offset',p_offset);
END;
$$;

CREATE OR REPLACE FUNCTION public.member_mark_notification_read(p_user_id uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  UPDATE public.member_notifications SET read_at=coalesce(read_at,now()) WHERE id=p_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification not found'; END IF;
  SELECT to_jsonb(n) INTO v FROM public.member_notifications n WHERE n.id=p_id; RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_execute_broadcast(p_owner_user_id uuid,p_broadcast_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_b public.owner_broadcasts%ROWTYPE; v_count bigint;
BEGIN
  IF NOT public.is_owner(p_owner_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT * INTO v_b FROM public.owner_broadcasts WHERE id=p_broadcast_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Broadcast not found'; END IF;
  IF v_b.status NOT IN ('draft','scheduled') THEN RAISE EXCEPTION 'Only draft or scheduled broadcasts can be executed'; END IF;
  IF v_b.status='scheduled' AND v_b.scheduled_at IS NOT NULL AND v_b.scheduled_at>now() THEN RAISE EXCEPTION 'Broadcast is scheduled for the future'; END IF;
  INSERT INTO public.member_profiles(user_id) SELECT id FROM auth.users ON CONFLICT(user_id) DO NOTHING;
  INSERT INTO public.member_notifications(user_id,title,body,broadcast_id)
  SELECT u.id,v_b.title,v_b.message,v_b.id FROM auth.users u LEFT JOIN public.member_profiles m ON m.user_id=u.id
  WHERE u.id<>p_owner_user_id AND (v_b.recipient_filter='all' OR coalesce(m.status,'active')=v_b.recipient_filter);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.owner_broadcasts SET status='sent',sent_at=now(),updated_at=now() WHERE id=p_broadcast_id;
  RETURN jsonb_build_object('broadcast_id',p_broadcast_id,'status','sent','recipients',v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_generation_statistics(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'utc')::date; v_week date := v_today-6; v_month date:=v_today-29; v_today_count bigint; v_week_count bigint; v_month_count bigint; v_days jsonb;
BEGIN
  IF NOT public.is_owner(p_user_id) THEN RAISE EXCEPTION 'Owner access required'; END IF;
  SELECT count(*) INTO v_today_count FROM public.am_generated_accounts WHERE created_at >= (v_today::timestamp AT TIME ZONE 'utc') AND created_at < ((v_today+1)::timestamp AT TIME ZONE 'utc');
  SELECT count(*) INTO v_week_count FROM public.am_generated_accounts WHERE created_at >= (v_week::timestamp AT TIME ZONE 'utc') AND created_at < ((v_today+1)::timestamp AT TIME ZONE 'utc');
  SELECT count(*) INTO v_month_count FROM public.am_generated_accounts WHERE created_at >= (v_month::timestamp AT TIME ZONE 'utc') AND created_at < ((v_today+1)::timestamp AT TIME ZONE 'utc');
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',d.day::date::text,'count',coalesce(x.count,0)) ORDER BY d.day),'[]'::jsonb) INTO v_days FROM generate_series(v_week,v_today,interval '1 day') d(day) LEFT JOIN (SELECT (created_at AT TIME ZONE 'utc')::date day,count(*) FROM public.am_generated_accounts WHERE created_at >= (v_week::timestamp AT TIME ZONE 'utc') AND created_at < ((v_today+1)::timestamp AT TIME ZONE 'utc') GROUP BY 1) x ON x.day=d.day::date;
  RETURN jsonb_build_object('today',v_today_count,'week',v_week_count,'month',v_month_count,'sevenDays',v_days);
END;
$$;

-- Login activity is recorded when Supabase updates last_sign_in_at.
CREATE OR REPLACE FUNCTION public.log_auth_login_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at AND NEW.last_sign_in_at IS NOT NULL THEN
    INSERT INTO public.owner_login_activity(user_id,event,success) VALUES(NEW.id,'login',true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_auth_login_activity ON auth.users;
CREATE TRIGGER trg_log_auth_login_activity AFTER UPDATE OF last_sign_in_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.log_auth_login_activity();

REVOKE ALL ON FUNCTION public.is_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_initial_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_initial_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_initial_owner() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_initial_owner(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.require_owner() TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT proname, pg_get_function_identity_arguments(oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('owner_list_members','owner_get_member','owner_update_member_profile','owner_set_member_status','owner_list_broadcasts','owner_get_broadcast','owner_create_broadcast','owner_update_broadcast','owner_delete_broadcast','owner_create_conversation','owner_list_conversations','owner_get_conversation','owner_send_message','member_list_conversations','member_get_conversation','member_send_message','member_mark_messages_read','owner_list_faq','owner_create_faq','owner_update_faq','owner_delete_faq','owner_list_help','owner_create_help','owner_update_help','owner_delete_help','owner_list_login_activity','owner_get_system_settings','owner_set_maintenance','public_get_maintenance','member_list_notifications','member_mark_notification_read','owner_execute_broadcast','owner_generation_statistics','log_auth_login_activity')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',r.proname,r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',r.proname,r.args);
  END LOOP;
END;
$$;

COMMIT;
