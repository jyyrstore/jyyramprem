-- Production parity patch V1
-- Aligns a clean rebuild with the currently verified production schema.
-- Idempotent and safe to run after the canonical runtime migrations.

BEGIN;

-- Foreign-key delete semantics verified against production.
ALTER TABLE public.member_profiles DROP CONSTRAINT IF EXISTS member_profiles_user_id_fkey;
ALTER TABLE public.member_profiles
  ADD CONSTRAINT member_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.member_status_events DROP CONSTRAINT IF EXISTS member_status_events_user_id_fkey;
ALTER TABLE public.member_status_events
  ADD CONSTRAINT member_status_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.member_status_events DROP CONSTRAINT IF EXISTS member_status_events_changed_by_fkey;
ALTER TABLE public.member_status_events
  ADD CONSTRAINT member_status_events_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.member_notifications DROP CONSTRAINT IF EXISTS member_notifications_broadcast_id_fkey;
ALTER TABLE public.member_notifications
  ADD CONSTRAINT member_notifications_broadcast_id_fkey
  FOREIGN KEY (broadcast_id) REFERENCES public.owner_broadcasts(id) ON DELETE SET NULL;

ALTER TABLE public.member_notifications DROP CONSTRAINT IF EXISTS member_notifications_message_id_fkey;
ALTER TABLE public.member_notifications
  ADD CONSTRAINT member_notifications_message_id_fkey
  FOREIGN KEY (message_id) REFERENCES public.owner_messages(id) ON DELETE SET NULL;

-- Runtime timestamp triggers present in production.
CREATE OR REPLACE FUNCTION public.touch_member_profile_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_profiles_touch_updated_at ON public.member_profiles;
CREATE TRIGGER member_profiles_touch_updated_at
BEFORE UPDATE ON public.member_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_member_profile_updated_at();

CREATE OR REPLACE FUNCTION public.owner_broadcasts_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_broadcasts_set_updated_at ON public.owner_broadcasts;
CREATE TRIGGER owner_broadcasts_set_updated_at
BEFORE UPDATE ON public.owner_broadcasts
FOR EACH ROW EXECUTE FUNCTION public.owner_broadcasts_touch_updated_at();

DROP TRIGGER IF EXISTS am_api_usage_touch ON public.am_api_usage;
CREATE TRIGGER am_api_usage_touch
BEFORE UPDATE ON public.am_api_usage
FOR EACH ROW EXECUTE FUNCTION public.am_touch_updated_at();

-- Constraints verified in production but absent from the rebuild migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_profiles_display_name_length') THEN
    ALTER TABLE public.member_profiles ADD CONSTRAINT member_profiles_display_name_length CHECK (display_name IS NULL OR (char_length(display_name) BETWEEN 1 AND 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_profiles_notes_length') THEN
    ALTER TABLE public.member_profiles ADD CONSTRAINT member_profiles_notes_length CHECK (notes IS NULL OR char_length(notes) <= 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_profiles_status_reason_length') THEN
    ALTER TABLE public.member_profiles ADD CONSTRAINT member_profiles_status_reason_length CHECK (status_reason IS NULL OR char_length(status_reason) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_status_events_old_status_check') THEN
    ALTER TABLE public.member_status_events ADD CONSTRAINT member_status_events_old_status_check CHECK (old_status IS NULL OR old_status IN ('active','suspended','banned'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_status_events_reason_length') THEN
    ALTER TABLE public.member_status_events ADD CONSTRAINT member_status_events_reason_length CHECK (reason IS NULL OR char_length(reason) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_broadcasts_title_len') THEN
    ALTER TABLE public.owner_broadcasts ADD CONSTRAINT owner_broadcasts_title_len CHECK (char_length(title) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_broadcasts_message_len') THEN
    ALTER TABLE public.owner_broadcasts ADD CONSTRAINT owner_broadcasts_message_len CHECK (char_length(message) BETWEEN 1 AND 10000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_broadcasts_schedule_consistency') THEN
    ALTER TABLE public.owner_broadcasts ADD CONSTRAINT owner_broadcasts_schedule_consistency CHECK ((status = 'scheduled' AND scheduled_at IS NOT NULL) OR status <> 'scheduled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_faq_question_check') THEN
    ALTER TABLE public.owner_faq ADD CONSTRAINT owner_faq_question_check CHECK (char_length(trim(question)) BETWEEN 3 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_faq_answer_check') THEN
    ALTER TABLE public.owner_faq ADD CONSTRAINT owner_faq_answer_check CHECK (char_length(trim(answer)) BETWEEN 1 AND 10000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_help_articles_title_check') THEN
    ALTER TABLE public.owner_help_articles ADD CONSTRAINT owner_help_articles_title_check CHECK (char_length(trim(title)) BETWEEN 3 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_help_articles_content_check') THEN
    ALTER TABLE public.owner_help_articles ADD CONSTRAINT owner_help_articles_content_check CHECK (char_length(trim(content)) BETWEEN 1 AND 20000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_help_articles_slug_check') THEN
    ALTER TABLE public.owner_help_articles ADD CONSTRAINT owner_help_articles_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_lock_id_check') THEN
    ALTER TABLE public.owner_lock ADD CONSTRAINT owner_lock_id_check CHECK (id = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_login_activity_event_check') THEN
    ALTER TABLE public.owner_login_activity ADD CONSTRAINT owner_login_activity_event_check CHECK (event IN ('login','logout','session_refresh'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_system_settings_id_check') THEN
    ALTER TABLE public.owner_system_settings ADD CONSTRAINT owner_system_settings_id_check CHECK (id = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='owner_system_settings_maintenance_message_check') THEN
    ALTER TABLE public.owner_system_settings ADD CONSTRAINT owner_system_settings_maintenance_message_check CHECK (char_length(maintenance_message) BETWEEN 1 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_notifications_title_check') THEN
    ALTER TABLE public.member_notifications ADD CONSTRAINT member_notifications_title_check CHECK (char_length(trim(title)) BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='member_notifications_body_check') THEN
    ALTER TABLE public.member_notifications ADD CONSTRAINT member_notifications_body_check CHECK (char_length(trim(body)) BETWEEN 1 AND 10000);
  END IF;
END;
$$;

-- Indexes verified in production but absent from the rebuild path.
CREATE INDEX IF NOT EXISTS am_api_usage_user_id_idx ON public.am_api_usage(user_id);
CREATE INDEX IF NOT EXISTS am_generated_accounts_user_id_idx ON public.am_generated_accounts(user_id);
CREATE INDEX IF NOT EXISTS am_generated_accounts_email_idx ON public.am_generated_accounts(email);
CREATE INDEX IF NOT EXISTS am_generation_logs_account_id_idx ON public.am_generation_logs(account_id);
CREATE INDEX IF NOT EXISTS member_notifications_broadcast_id_idx ON public.member_notifications(broadcast_id);
CREATE INDEX IF NOT EXISTS member_notifications_message_id_idx ON public.member_notifications(message_id);
CREATE INDEX IF NOT EXISTS member_status_events_changed_by_created_idx ON public.member_status_events(changed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS owner_broadcasts_created_by_idx ON public.owner_broadcasts(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS owner_broadcasts_status_created_at_idx ON public.owner_broadcasts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS owner_conversations_created_by_idx ON public.owner_conversations(created_by);
CREATE INDEX IF NOT EXISTS owner_conversations_member_idx ON public.owner_conversations(member_user_id);
CREATE INDEX IF NOT EXISTS owner_faq_created_by_idx ON public.owner_faq(created_by);
CREATE INDEX IF NOT EXISTS owner_help_articles_created_by_idx ON public.owner_help_articles(created_by);
CREATE INDEX IF NOT EXISTS owner_login_activity_user_created_idx ON public.owner_login_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS owner_messages_sender_user_id_idx ON public.owner_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS owner_system_settings_updated_by_idx ON public.owner_system_settings(updated_by);

-- Keep direct client access closed for security-definer runtime functions.
REVOKE EXECUTE ON FUNCTION public.touch_member_profile_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.owner_broadcasts_touch_updated_at() FROM PUBLIC, anon, authenticated;

COMMIT;
