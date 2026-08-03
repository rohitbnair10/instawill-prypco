-- =====================================================================
-- Clarification email — one-time migration
-- =====================================================================
-- The ONLY thing this workflow needs: a marker so a clarification is
-- emailed exactly once. `status` already moves sent -> answered -> resolved,
-- but we can't key the send off `status = 'sent'` alone or we'd re-email
-- every minute until the client replies. `notified_at` is that "already sent"
-- stamp. Safe to run on an existing database — additive only, no data touched.

alter table clarifications
  add column if not exists notified_at timestamptz;

-- Fast lookup of the (usually tiny) set still owed an email.
create index if not exists clarifications_pending_notify_idx
  on clarifications (status)
  where notified_at is null;
