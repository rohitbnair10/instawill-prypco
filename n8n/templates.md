# Email templates (authored in n8n)

One template per `trigger_state`, plus a confirmation per resolved state. Tone
matches the client UI guardrail: **calm, human, reassuring — never make the
client feel doubted or that they erred.** Each email = one clear reason + one
primary CTA (the secure portal link) + a plain-language line on what's needed.

**Personalisation tokens** (map to n8n expressions on the item):

| Token | n8n expression | Source |
|---|---|---|
| `{{name}}` | `{{$json.full_name}}` | `leads.full_name` (first name is nicer: `{{$json.full_name.split(' ')[0]}}`) |
| `{{portal_link}}` | `{{$json.portal_link}}` | built per send (see README → "The portal link") |
| `{{what_needed}}` | `{{$json.blocking_reason}}` | `notifications.blocking_reason_snapshot` / the will's open checks |

**Cadence tone** — the same state template is reused for step_1/2/3; only the
opening line warms up. Switch on `{{$json.sequence_step}}`:
- `step_1` — neutral, informative.
- `step_2` (+2d) — gentle nudge ("just circling back").
- `step_3` (+5d) — warmer, offers help ("anything we can do?").

---

## `documents_pending` — "Finish your documents"

**Subject:** `Just one step left on your will, {{name}}`

> Hi {{name}},
>
> Your will is drafted and ready — we just need **{{what_needed}}** to send it to
> your lawyer for review.
>
> It takes about two minutes, and you can do it from your phone.
>
> **[ Finish your documents → ]({{portal_link}})**
>
> No rush, and nothing's lost — your will is saved exactly where you left it.
>
> — The InstaWill team

*step_2 opener:* "Just circling back — your will's all set apart from **{{what_needed}}**."
*step_3 opener:* "We're still holding your will ready. If **{{what_needed}}** is tricky, reply and we'll help."

---

## `awaiting_client` — "Your lawyer has a question"

**Subject:** `A quick question from your lawyer, {{name}}`

> Hi {{name}},
>
> Your lawyer is reviewing your will and has **one quick question** before they
> finish. Answering it keeps everything moving.
>
> **[ Read & reply → ]({{portal_link}})**
>
> It's a normal part of getting your will exactly right — a two-minute reply and
> you're done.
>
> — The InstaWill team

*step_2 opener:* "Just a gentle reminder — your lawyer's waiting on one quick answer."
*step_3 opener:* "Your lawyer's ready to finish as soon as they hear from you — need a hand replying?"

---

## `pending_client_approval` — "Your will is ready — review & approve"

**Subject:** `Your will is ready to approve, {{name}}`

> Hi {{name}},
>
> Good news — your lawyer has reviewed and finalised your will. The last step is
> yours: **have a read and approve it**, and we'll move it to registration.
>
> **[ Review & approve your will → ]({{portal_link}})**
>
> Take your time. Nothing is registered until you're happy and give the go-ahead.
>
> — The InstaWill team

*step_2 opener:* "Your finalised will is still waiting for your approval whenever you're ready."
*step_3 opener:* "You're one click from done — your will just needs your approval. Any questions, just reply."

---

## `changes_requested` — "A change was requested"

**Subject:** `A small change on your will, {{name}}`

> Hi {{name}},
>
> A change was requested on your will, so it's back with you for a quick look.
> Once you've reviewed it, your lawyer will take it from there.
>
> **[ Review the change → ]({{portal_link}})**
>
> This is exactly how we make sure your will says precisely what you want.
>
> — The InstaWill team

*step_2 opener:* "Just circling back on the change to your will whenever you have a moment."
*step_3 opener:* "Still here to help — your will's ready for your quick review. Reply if anything's unclear."

---

## `abandoned` — re-engagement nudge (≥3 days)

**Subject:** `Your will is saved and ready when you are, {{name}}`

> Hi {{name}},
>
> You started your DIFC will with us a little while ago — and it's saved exactly
> where you left off. Whenever you have a few minutes, you can pick straight back up.
>
> **[ Continue your will → ]({{portal_link}})**
>
> No pressure at all. If something got in the way or you have a question, just
> reply to this email — a real person will help.
>
> — The InstaWill team

---

## Confirmations (loop closure)

Fired once when the client acts. `template_key = confirm_<state they left>`.

### `confirm_documents_pending`
**Subject:** `Got your documents, {{name}} — thank you`
> Thanks, {{name}} — your documents are in. Your lawyer will review your will
> within 24 hours, and we'll email you the moment there's an update. Nothing more
> to do right now.

### `confirm_awaiting_client`
**Subject:** `Thanks {{name}} — that's with your lawyer now`
> Thanks, {{name}} — we've passed your answer to your lawyer. They'll pick your
> review straight back up; we'll be in touch as soon as it's ready.

### `confirm_pending_client_approval`
**Subject:** `You've approved your will, {{name}} 🎉`
> That's the big one done, {{name}} — you've approved your will. It's now moving to
> registration with the DIFC Wills Registry, and we'll confirm your appointment slot
> shortly.

### `confirm_changes_requested`
**Subject:** `Thanks {{name}} — your change is with the lawyer`
> Thanks, {{name}} — your review is back with your lawyer. We'll let you know as
> soon as it's finalised.
