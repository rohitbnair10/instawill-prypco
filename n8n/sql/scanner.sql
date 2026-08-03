-- =====================================================================
-- Workflow 02 — SCANNER  (polling, Schedule trigger every 1 min)
-- =====================================================================
-- Sends everything that's DUE and un-sent:
--   * step_2 / step_3 reminders — but ONLY if the will is STILL in that pending
--     state (the trigger cancels them the instant the client acts), and
--   * confirmation emails — queued by the trigger when a client finishes.
-- The "claim" update makes double-sends impossible even with overlapping runs.
-- All queries validated on Postgres 16.


-- 1) SELECT DUE — one item per email to send. Reminders are gated on the will
--    still being in-state; confirmations always send (state has already moved).
select
  n.id            as notification_id,
  n.will_id,
  n.lead_id,
  n.trigger_state,
  n.sequence_step,               -- step_2 | step_3 | confirmation
  n.template_key,                -- e.g. documents_pending | confirm_documents_pending
  n.portal_link,
  n.blocking_reason_snapshot,
  l.full_name,
  l.email
from notifications n
join wills w on w.id = n.will_id
join leads l on l.id = n.lead_id
where n.sent_at is null
  and n.cancelled_at is null
  and n.scheduled_for <= now()
  and n.source = 'system'
  and (
        (n.sequence_step in ('step_2','step_3') and w.active_notification_state = n.trigger_state)
     or  n.sequence_step = 'confirmation'
      )
order by n.scheduled_for
limit 50;


-- 2) CLAIM — run per item BEFORE sending. Returns the row only if THIS run wins;
--    0 rows => already sent/cancelled elsewhere => skip the email (IF after).
--   $1 notification_id
update notifications
set sent_at = now()
where id = $1 and sent_at is null and cancelled_at is null
returning id, sequence_step, template_key;


-- 3) After a reminder (not a confirmation) sends, keep the counter honest.
--   $1 will_id
update wills
set notification_count = notification_count + 1, last_notification_at = now()
where id = $1;
