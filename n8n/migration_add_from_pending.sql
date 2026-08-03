-- Migration for an ALREADY-CREATED InstaWill database.
--
-- Adds `from_client_action_pending` to the will_status_changed event payload so
-- the n8n workflow can fire the loop-closure confirmation email when a client
-- LEAVES a pending state, without re-listing the client-pending states in n8n
-- (the guard stays authoritative in the DB).
--
-- Safe to run on the live project: it's a CREATE OR REPLACE of the trigger
-- function only — no table changes, no data touched. Run it once in the
-- Supabase SQL editor. (schema.sql already includes this for fresh installs.)

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
        'from', old.status,
        'to', new.status,
        'client_action_pending', new_pending,
        'from_client_action_pending', old_pending
      ));

    -- Left a client-pending state → cancel the running cadence (loop self-cancel).
    if old_pending then
      update notifications
        set cancelled_at = now()
        where will_id = new.id
          and sent_at is null
          and cancelled_at is null;
      new.active_notification_state := null;
    end if;

    -- Entered a client-pending state → arm a fresh cadence.
    if new_pending then
      new.active_notification_state := new.status::text::notification_trigger_state;
      new.notification_count := 0;
      new.last_notification_at := null;
    end if;
  end if;
  return new;
end $$;
