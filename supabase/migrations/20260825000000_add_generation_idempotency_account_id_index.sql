create index if not exists am_generation_idempotency_account_id_idx
  on public.am_generation_idempotency (account_id);
