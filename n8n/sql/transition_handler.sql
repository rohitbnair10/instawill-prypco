-- =====================================================================
-- Workflow 01 — TRANSITION HANDLER  (Postgres-node queries)
-- =====================================================================
-- Triggered by the Supabase Database Webhook on `events` INSERT. The webhook
-- POSTs { type, table, record, ... }; the row is at $json.body.record, so:
--   record.event_type              -> "will_status_changed"
--   record.payload.to              -> new will status
--   record.payload.from            -> old will status
--   record.payload.client_action_pending        -> fire a cadence?
--   record.payload.from_client_action_pending    -> fire a confirmation?
--   record.will_id / record.lead_id
--
-- Each block below is one Postgres "Execute Query" node. Use n8n Query
-- Parameters ($1, $2, ...) — never string-concatenate values into SQL.
-- All queries validated against schema.sql on Postgres 16.


-- ---------------------------------------------------------------------
-- ENTRY BRANCH  (record.payload.client_action_pending === true)
-- ---------------------------------------------------------------------

-- 1a) Log the immediate step-1 send. Run this AFTER the email node succeeds
--     (or before, then send — either is fine; sent_at marks it done).
--   $1 will_id     = {{$json.body.record.will_id}}
--   $2 lead_id     = {{$json.body.record.lead_id}}
--   $3 trigger_state = {{$json.body.record.payload.to}}
--   $4 template_key  = {{$json.body.record.payload.to}}         (one template per state)
--   $5 portal_link   = {{$json.portal_link}}   (built earlier — see README "portal link")
--   $6 blocking_reason = {{$json.blocking_reason}}  (optional; from the will/checks)
insert into notifications
  (will_id, lead_id, trigger_state, channel, source, sequence_step,
   template_key, portal_link, blocking_reason_snapshot, sent_at)
values ($1, $2, $3::notification_trigger_state, 'email', 'system', 'step_1',
        $4, $5, $6, now())
returning id;

-- 1b) Idempotency guard for step-1: only proceed if we haven't already opened a
--     cadence for THIS entry. Optional but recommended — put an IF before 1a
--     that runs this and checks count = 0.
--   $1 will_id, $2 trigger_state
select count(*) as already_sent
from notifications
where will_id = $1
  and trigger_state = $2::notification_trigger_state
  and sequence_step = 'step_1'
  and sent_at is not null
  and cancelled_at is null;

-- 1c) Advance the will's cadence bookkeeping.
--   $1 will_id
update wills
set notification_count = notification_count + 1,
    last_notification_at = now()
where id = $1;

-- 1d) Pre-create the two scheduled reminders (+2 days, +5 days). The scanner
--     (workflow 02) sends them when due; the status trigger cancels them the
--     instant the client acts.
--   $1 will_id, $2 lead_id, $3 trigger_state, $4 template_key, $5 portal_link
insert into notifications
  (will_id, lead_id, trigger_state, channel, source, sequence_step, template_key, portal_link, scheduled_for)
values
  ($1, $2, $3::notification_trigger_state, 'email', 'system', 'step_2', $4, $5, now() + interval '2 days'),
  ($1, $2, $3::notification_trigger_state, 'email', 'system', 'step_3', $4, $5, now() + interval '5 days');


-- ---------------------------------------------------------------------
-- EXIT BRANCH  (record.payload.from_client_action_pending === true
--               AND record.payload.client_action_pending === false)
--   The client acted → the status trigger already cancelled the un-sent
--   reminders. All we do here is send + log the loop-closure confirmation.
-- ---------------------------------------------------------------------

-- 2a) Log the confirmation. trigger_state = the state they just LEFT.
--   $1 will_id, $2 lead_id
--   $3 trigger_state = {{$json.body.record.payload.from}}
--   $4 template_key  = confirm_{{$json.body.record.payload.from}}
insert into notifications
  (will_id, lead_id, trigger_state, channel, source, sequence_step, template_key, sent_at)
values ($1, $2, $3::notification_trigger_state, 'email', 'system', 'confirmation', $4, now())
returning id;

-- (Everything else on exit — cancelling step_2/step_3, clearing
--  active_notification_state — was done atomically by the DB trigger. n8n does
--  NOT need to cancel anything.)
