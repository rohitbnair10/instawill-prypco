# Clarification email — the only workflow you need

**One job:** when a lawyer raises a clarification, the client gets one email with
the question and a link to reply. Nothing else — no cadence, no reminders, no
confirmations, no abandoned scan.

## How it works

Raising a clarification writes a `clarifications` row (`status = 'sent'`) and
holds the lawyer's approved question in `message_final`. This workflow polls once
a minute, sends that question to the client, and stamps `notified_at` so it never
sends twice.

```
Schedule (1 min)  →  SELECT pending  →  Send email  →  Mark notified
```

`SELECT` returns one item per pending clarification (n8n reliably emits SELECT
rows as items — an `UPDATE … RETURNING` does **not**, it just reports
`{success:true}`, which is why this is a SELECT and not a one-shot claim). After
the email sends, `Mark notified` stamps `notified_at`, so the next poll skips it.
No `notifications` table, no DB trigger, no webhook.

**Send-then-mark** is deliberate: if SMTP fails, the row stays un-notified and
retries next minute (delivery matters more here than a vanishingly rare
double-send). At a 1-minute cadence with sub-second runs the poll never overlaps
itself, so in practice each clarification goes out exactly once.

## Setup

1. **Migrate (once).** Run `migration.sql` in the Supabase SQL editor — it adds
   the `notified_at` marker column. Additive, safe on a live DB.
2. **Postgres credential** in n8n → Supabase **Session pooler** (IPv4):
   host `aws-0-<region>.pooler.supabase.com`, port `5432`, db `postgres`,
   user `postgres.<project-ref>`, your DB password, SSL **require**.
3. **Email credential** (SMTP / Resend / SendGrid). Set a real `fromEmail`.
4. **Variable:** Settings → Variables → `APP_URL = https://app.instawill.ae`
   (used for the reply link; falls back to that default if unset).
5. Import `clarification_email.json`, assign both credentials on the red nodes,
   toggle **Active**.

## Test

Needs one existing row in `users` (for `raised_by`). Uses Resend's test sink so
it sends on the free tier:

```sql
do $$
declare v_lead uuid; v_will uuid; v_user uuid;
begin
  select id into v_user from users limit 1;
  insert into leads (email, full_name, current_stage)
    values ('delivered@resend.dev', 'Test Client', 'review')
    returning id into v_lead;
  insert into wills (lead_id, status)
    values (v_lead, 'awaiting_client')
    returning id into v_will;
  insert into clarifications
    (will_id, raised_by, mode, question, message_preview, message_final, channel, status)
  values
    (v_will, v_user, 'question',
     'Need the guardian''s date of birth',
     'draft',
     'Hi — to finish your will we just need the date of birth of the guardian you named. Could you reply with that?',
     'email', 'sent');
end $$;
```

Within a minute the email goes out and `notified_at` is stamped (re-runs send
nothing). Clean up:

```sql
delete from leads where email = 'delivered@resend.dev';  -- cascades to will + clarification
```

## Note on going live

The app still writes state to **localStorage**, so a real "Ask the client" click
in the lawyer desk won't create a Postgres `clarifications` row yet — that's the
store → Supabase port (Stage 2). Until then, the SQL above is how you exercise it.

## Production hardening

- Switch the Postgres node to **Query Parameters** rather than the inline query
  if you ever templatize it with user input (this query takes none, so it's already safe).
- Sign or tokenize the portal link instead of exposing the raw `will_id`.
