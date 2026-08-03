-- =====================================================================
-- Workflow 02 — REMINDER SCANNER  (Schedule trigger, e.g. every 15 min)
-- =====================================================================
-- Sends the +2d / +5d reminders when they come due — but ONLY if the will is
-- still sitting in the same client-pending state (belt-and-suspenders in case a
-- webhook was missed; the DB trigger already cancels un-sent rows on exit).
-- The "claim" pattern makes double-sends impossible even if two scanner runs
-- overlap. All queries validated against schema.sql on Postgres 16.


-- 1) SELECT DUE  — the scanner's input. Emits one item per reminder to send.
select
  n.id            as notification_id,
  n.will_id,
  n.lead_id,
  n.trigger_state,
  n.sequence_step,
  n.template_key,
  n.portal_link,
  n.blocking_reason_snapshot,
  l.full_name,
  l.email,
  w.status        as will_status
from notifications n
join wills w on w.id = n.will_id
join leads l on l.id = n.lead_id
where n.sent_at is null
  and n.cancelled_at is null
  and n.scheduled_for <= now()
  and n.source = 'system'
  -- only if the will is STILL in the state this reminder was queued for:
  and w.active_notification_state = n.trigger_state
order by n.scheduled_for
limit 50;


-- 2) CLAIM  — run for EACH item from step 1, BEFORE sending the email.
--    Returns the row only if THIS run wins the claim; if it returns 0 rows,
--    another run already sent/cancelled it → skip the email (add an IF after).
--   $1 notification_id = {{$json.notification_id}}
update notifications
set sent_at = now()
where id = $1
  and sent_at is null
  and cancelled_at is null
returning id;


-- 3) After a successful send, advance the will counter (optional but keeps
--    notification_count honest for the metrics).
--   $1 will_id = {{$json.will_id}}
update wills
set notification_count = notification_count + 1,
    last_notification_at = now()
where id = $1;
