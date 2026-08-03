-- =====================================================================
-- Optional — OPEN / CLICK TRACKING  (a small extra webhook workflow)
-- =====================================================================
-- The portal links in the emails carry the notification id (e.g.
-- https://app/portal/{will}?n={notification_id}). A tiny n8n Webhook workflow
-- (or your app's /portal route) stamps opened_at / clicked_at so the
-- v_notification_conversion metric becomes real.

-- CLICK — when the client clicks the portal CTA.
--   $1 notification_id
update notifications
set clicked_at = coalesce(clicked_at, now())
where id = $1
returning will_id, lead_id, trigger_state, sequence_step;

-- OPEN — tracking-pixel hit (email opened).
--   $1 notification_id
update notifications
set opened_at = coalesce(opened_at, now())
where id = $1;

-- Log a click as an event too, so it lives on the same event stream the
-- metrics read (one source of truth).
--   $1 will_id, $2 lead_id, $3 notification_id
insert into events (will_id, lead_id, event_type, payload)
values ($1, $2, 'notification_clicked', jsonb_build_object('notification_id', $3));
