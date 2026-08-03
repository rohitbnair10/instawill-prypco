-- Migration for an ALREADY-CREATED InstaWill database.
--
-- Upgrades the status-change trigger for the POLLING notification design (no
-- Supabase webhook, no pg_net required). On top of the base schema it:
--   * adds `from_client_action_pending` to the event payload, and
--   * QUEUES a confirmation notification (due now) when a client leaves a
--     pending state — so the polling scanner sends the "thank you" email with
--     no extra n8n branch and no webhook.
--
-- Safe to run on the live project: CREATE OR REPLACE of the trigger function
-- only — no table changes, no data touched. Run once in the Supabase SQL editor.
-- (Fresh installs from supabase/schema.sql already include this.)

create or replace function on_will_status_change() returns trigger
language plpgsql as $$
declare
  new_pending boolean := client_action_pending(new.status);
  old_pending boolean := client_action_pending(old.status);
begin
  if new.status is distinct from old.status then
    insert into events (will_id, lead_id, event_type, payload)
    values (new.id, new.lead_id, 'will_status_changed',
      jsonb_build_object(
        'from', old.status, 'to', new.status,
        'client_action_pending', new_pending,
        'from_client_action_pending', old_pending));

    if old_pending then
      update notifications
        set cancelled_at = now()
        where will_id = new.id
          and sent_at is null
          and cancelled_at is null
          and sequence_step <> 'confirmation';
      new.active_notification_state := null;

      -- loop closure: queue the confirmation for the polling scanner to send
      if not new_pending then
        insert into notifications
          (will_id, lead_id, trigger_state, channel, source, sequence_step, template_key, scheduled_for)
        values (new.id, new.lead_id, old.status::text::notification_trigger_state,
                'email', 'system', 'confirmation', 'confirm_' || old.status::text, now());
      end if;
    end if;

    if new_pending then
      new.active_notification_state := new.status::text::notification_trigger_state;
      new.notification_count := 0;
      new.last_notification_at := null;
    end if;
  end if;
  return new;
end $$;
