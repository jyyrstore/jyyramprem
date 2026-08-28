-- Rebuild base for the current runtime contract.
-- This is a new canonical rebuild migration, not a claim to reproduce the
-- missing historical 2026-08-19 migration bodies byte-for-byte.

CREATE TABLE IF NOT EXISTS public.am_generated_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id text,
  email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  provider_status_code integer,
  provider_message text,
  provider_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);

CREATE TABLE IF NOT EXISTS public.am_generation_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid REFERENCES public.am_generated_accounts(id) ON DELETE SET NULL,
  event text NOT NULL,
  status_code integer,
  message text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.am_api_usage (
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  success_count integer NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (usage_date, user_id)
);

CREATE INDEX IF NOT EXISTS am_generated_accounts_user_created_idx
  ON public.am_generated_accounts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS am_generated_accounts_created_at_idx
  ON public.am_generated_accounts(created_at DESC);
CREATE INDEX IF NOT EXISTS am_generation_logs_account_created_idx
  ON public.am_generation_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS am_api_usage_user_date_idx
  ON public.am_api_usage(user_id, usage_date DESC);

ALTER TABLE public.am_generated_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_generation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_api_usage ENABLE ROW LEVEL SECURITY;

-- Temporary legacy signatures kept only so the historical hardening migration
-- can safely revoke them before the final per-user quota RPCs are installed.
CREATE OR REPLACE FUNCTION public.reserve_api_usage(p_usage_date date, p_daily_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN NULL; END; $$;
CREATE OR REPLACE FUNCTION public.record_api_usage_result(p_usage_date date, p_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN NULL; END; $$;
CREATE OR REPLACE FUNCTION public.reserve_api_usage(p_user_id uuid, p_usage_date date, p_daily_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN NULL; END; $$;
CREATE OR REPLACE FUNCTION public.record_api_usage_result(p_user_id uuid, p_usage_date date, p_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN NULL; END; $$;
REVOKE ALL ON FUNCTION public.reserve_api_usage(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_api_usage_result(date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_api_usage(uuid, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_api_usage_result(uuid, date, boolean) FROM PUBLIC, anon, authenticated;
