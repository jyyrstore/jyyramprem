-- Production cleanup: remove the obsolete duplicate timestamp trigger.
-- Safe/idempotent: does not touch table data.
DROP TRIGGER IF EXISTS am_generated_accounts_touch
ON public.am_generated_accounts;
