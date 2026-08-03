# Client approval-request email

**One job:** the moment a lawyer approves a draft and sends it to the client,
the client gets one email — "your will is ready to review." Nothing else, same
philosophy as `n8n/clarification/`: no cadence, no reminders, no confirmations.

## How it works

Approving a will sets `wills.status = 'pending_client_approval'` and
`lawyer_approved_at = now()`. This workflow polls once a minute, emails the
client, and stamps `approval_notified_at` so it never sends twice.

```
Schedule (1 min)  →  SELECT pending  →  Send email  →  Mark notified
```

Same shape as the clarification workflow, and for the same reason: `SELECT`
reliably emits one item per row; an `UPDATE ... RETURNING` does not (n8n's
Postgres node just reports `{success:true}` for it), so this claims by
sending first, then marking — never the other way around.

**Send-then-mark** is deliberate: if SMTP fails, the will stays un-notified and
retries next minute (delivery matters more than a vanishingly rare double-send
at a 1-minute cadence with sub-second runs).

## Setup

1. **Migrate (once).** Run `migration.sql` in the Supabase SQL editor — it adds
   the `wills.approval_notified_at` marker column. Additive, safe on a live DB.
2. **Postgres credential** in n8n → Supabase **Session pooler** (IPv4):
   host `aws-0-<region>.pooler.supabase.com`, port `5432`, db `postgres`,
   user `postgres.<project-ref>`, your DB password, SSL **require**. (Reuse the
   same credential as the clarification workflow if you already set one up.)
3. **Email credential** (SMTP / Resend / SendGrid). Set a real `fromEmail`.
4. Import `client_approval_email.json`, assign both credentials on the red
   nodes, toggle **Active**.

The reply link is a **static demo URL** (`https://instawill-prypco.vercel.app`),
same as the clarification email — fine for a demo. For production, swap it for
a signed/tokenized per-will portal link.

## Wired to the real lawyer desk

Clicking **"Approve draft → send to client"** in the lawyer desk now mirrors
into Postgres automatically — no manual SQL needed. `src/components/lawyer/LawyerDesk.tsx`
fires a background request to `POST /api/approval-requests`
(`src/app/api/approval-requests/route.ts`), which:

1. finds/creates the lead in Postgres by email,
2. finds/creates a will for that lead,
3. sets `status = 'pending_client_approval'`, `lawyer_approved_at = now()`,
   and resets `approval_notified_at = null` (so a re-approval after a change
   emails the client again).

That row is exactly what the poller above is watching for.

**Requires** `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`, same key the
clarification route uses) — the anon key can't insert/update these tables
(no anon write policy by design). If unset, the route no-ops silently and the
local demo flow is unaffected.

**Deliverability note:** same as the clarification workflow — seed demo leads
use `@example.com` addresses, which Resend's free tier rejects. Use a lead with
a real email (via the client journey's contact-details step) or
`delivered@resend.dev` for testing.

## Test

```sql
do $$
declare v_lead uuid; v_will uuid;
begin
  insert into leads (email, full_name, current_stage)
    values ('delivered@resend.dev', 'Test Client', 'pending_client_approval')
    returning id into v_lead;
  insert into wills (lead_id, status, lawyer_approved_at)
    values (v_lead, 'pending_client_approval', now())
    returning id into v_will;
end $$;
```

Within a minute the email goes out and `approval_notified_at` is stamped
(re-runs send nothing). Clean up:

```sql
delete from leads where email = 'delivered@resend.dev';  -- cascades to will
```

## Production hardening

- Swap the static demo link for a real per-will portal link, signed or
  tokenized, rather than a flat homepage URL.
- Switch the Postgres node to **Query Parameters** if you ever templatize
  the SELECT with user input (it currently takes none, so it's already safe).
