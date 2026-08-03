-- =====================================================================
-- Workflow 03 — ABANDONED SCANNER  (Schedule trigger, e.g. daily 09:00)
-- =====================================================================
-- The abandoned nudge is TIME-based, not a status transition — a lead that
-- started intake and went quiet. So it has its own scanner rather than hanging
-- off the status trigger. One nudge per stall (re-arms automatically if they
-- make progress, because stage_updated_at moves forward).
-- Threshold: 3 days (your choice). Validated against schema.sql on Postgres 16.


-- 1) SELECT ABANDONED  — leads still in an intake stage, quiet >= 3 days, and
--    NOT already nudged since they last progressed.
select
  l.id        as lead_id,
  l.full_name,
  l.email,
  l.phone,
  l.current_stage,
  w.id        as will_id
from leads l
join wills w on w.lead_id = l.id
where l.current_stage in ('identity','wishes','confirm','documents','review')
  and l.stage_updated_at < now() - interval '3 days'
  and not exists (
    select 1 from notifications n
    where n.lead_id = l.id
      and n.trigger_state = 'abandoned'
      and n.created_at > l.stage_updated_at   -- nothing sent since their last progress
  )
limit 50;


-- 2) LOG THE ABANDONED NUDGE  — run for EACH item, AFTER the email sends.
--    (No pre-scheduled reminders here; if you want a cadence, schedule step_2/3
--     rows exactly like the transition handler does.)
--   $1 will_id, $2 lead_id, $3 portal_link, $4 blocking_reason
insert into notifications
  (will_id, lead_id, trigger_state, channel, source, sequence_step,
   template_key, portal_link, blocking_reason_snapshot, sent_at)
values ($1, $2, 'abandoned', 'email', 'system', 'step_1',
        'abandoned', $3, $4, now())
returning id;


-- 3) OPTIONAL — mark the outcome later (recovered / no_response / opted_out).
--    E.g. an ops agent logs a call, or you detect the lead resumed.
--   $1 notification_id, $2 outcome ('recovered'|'no_response'|'opted_out')
update notifications
set outcome = $2::notification_outcome
where id = $1;
