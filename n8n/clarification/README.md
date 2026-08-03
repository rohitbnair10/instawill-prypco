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
4. Import `clarification_email.json`, assign both credentials on the red nodes,
   toggle **Active**.

The reply link is a **static URL** (`https://instawill-prypco.vercel.app`) hardcoded
in the email HTML — fine for a demo. For production, replace it with a signed or
tokenized per-will link (see "Production hardening" below) rather than exposing a
raw id or sending everyone to the same landing page.

## Test

Creates a staff user if none exists (`raised_by` is NOT NULL — without this the
whole block silently rolls back). Uses Resend's test sink so it sends on the free
tier:

```sql
do $$
declare v_lead uuid; v_will uuid; v_user uuid;
begin
  select id into v_user from users limit 1;
  if v_user is null then
    insert into users (name, role, email)
      values ('Test Lawyer', 'lawyer', 'lawyer@instawill.ae')
      returning id into v_user;
  end if;
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

## Wired to the real lawyer desk

A real "Ask the client" → **Send** click in the lawyer desk now mirrors into
Postgres automatically — no manual SQL needed. The UI still runs on the local
demo store (unchanged), but `send()` in `ClarifyPanel`
(`src/components/lawyer/LawyerDesk.tsx`) also fires a background request to
`POST /api/clarifications` (`src/app/api/clarifications/route.ts`), which:

1. finds/creates the lead in Postgres by email,
2. finds/creates a will for that lead,
3. finds/creates a demo lawyer user (no real auth yet, so `raised_by` needs
   *some* staff row — one is created once and reused),
4. inserts the `clarifications` row with `status = 'sent'`.

That row is exactly what the poller above is watching for — the email goes out
within a minute, no manual SQL required.

**Requires** `SUPABASE_SERVICE_ROLE_KEY` set (server-side only, see
`.env.example`) — the anon key can't insert into these tables (no anon INSERT
policy by design), so the route uses the service-role key to bypass RLS. If
that key isn't set, the route no-ops silently and the local demo flow is
unaffected — nothing to configure if you don't want the live wiring yet.

**Deliverability note:** the seed demo leads all use `@example.com` addresses,
which Resend's free tier rejects (see the earlier fix in this repo). To
actually receive the email, either add your own real address as a lead in the
UI, or manually point a test lead's email at `delivered@resend.dev` /
your own inbox in Supabase before clicking Send.

This is intentionally scoped — only the clarification path writes to Postgres.
The rest of the app (intake, documents, approvals) still runs on localStorage;
porting all of it is a separate, larger job.

## Production hardening

- Switch the Postgres node to **Query Parameters** rather than the inline query
  if you ever templatize it with user input (this query takes none, so it's already safe).
- Swap the static demo link for a real per-will portal link, signed or tokenized
  (e.g. `{APP_URL}/portal/{will_id}?n={clarification_id}`) rather than a flat
  homepage URL or a raw exposed `will_id`.
