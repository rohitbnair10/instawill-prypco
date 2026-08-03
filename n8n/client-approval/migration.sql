-- =====================================================================
-- Client-approval email — one-time migration
-- =====================================================================
-- The ONLY thing this workflow needs: a marker so a "your will is ready to
-- review" email fires exactly once per approval. `status` moves to
-- 'pending_client_approval' the moment the lawyer approves, but we can't key
-- the send off status alone or we'd re-email every minute the will sits in
-- that state. `approval_notified_at` is that "already sent" stamp. Safe to
-- run on an existing database — additive only, no data touched.

alter table wills
  add column if not exists approval_notified_at timestamptz;

-- Fast lookup of the (usually tiny) set of wills still owed this email.
create index if not exists wills_pending_approval_notify_idx
  on wills (status)
  where status = 'pending_client_approval' and approval_notified_at is null;
