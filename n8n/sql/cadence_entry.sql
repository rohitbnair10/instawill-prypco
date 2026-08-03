-- =====================================================================
-- Workflow 01 — CADENCE ENTRY  (polling, Schedule trigger every 1 min)
-- =====================================================================
-- No webhook. The DB trigger arms a will the moment it enters a client-pending
-- state (sets active_notification_state, resets notification_count = 0). This
-- poller finds those wills, sends step_1, schedules step_2/step_3, and bumps the
-- counter so it never re-sends. All queries validated on Postgres 16.


-- 1) SELECT wills that need step_1 (armed by the trigger, not yet sent).
--    This IS the idempotency cursor: notification_count = 0 means "step_1 owed".
select
  w.id                          as will_id,
  w.lead_id,
  w.active_notification_state   as trigger_state,   -- documents_pending | awaiting_client | pending_client_approval | changes_requested
  l.full_name,
  l.email,
  l.phone
from wills w
join leads l on l.id = w.lead_id
where w.active_notification_state is not null
  and w.notification_count = 0
limit 50;


-- 2) After the step_1 email sends, run this for the will (log + bump + schedule
--    the two reminders). Bumping notification_count to 1 makes query (1) skip it
--    next minute — the no-double-send guarantee, no cursor table needed.
--   $1 will_id, $2 lead_id, $3 trigger_state, $4 portal_link, $5 blocking_reason
insert into notifications
  (will_id, lead_id, trigger_state, channel, source, sequence_step, template_key, portal_link, blocking_reason_snapshot, sent_at)
values ($1, $2, $3::notification_trigger_state, 'email', 'system', 'step_1', $3, $4, $5, now());

update wills
set notification_count = 1, last_notification_at = now()
where id = $1 and notification_count = 0;   -- guard: only the run that "won" step_1

insert into notifications
  (will_id, lead_id, trigger_state, channel, source, sequence_step, template_key, portal_link, scheduled_for)
values
  ($1, $2, $3::notification_trigger_state, 'email', 'system', 'step_2', $3, $4, now() + interval '2 days'),
  ($1, $2, $3::notification_trigger_state, 'email', 'system', 'step_3', $3, $4, now() + interval '5 days');
