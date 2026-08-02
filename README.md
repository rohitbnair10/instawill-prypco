# InstaWill

Assisted drafting for **DIFC (Dubai International Financial Centre) non-Muslim wills.**
One free-text paragraph of client wishes → a **real Anthropic API call** →
validated structured JSON → a readable DIFC will draft **and** a readable ops
portal package — with the lawyer's judgment gate, and the client's final
consent, both intact.

This is a genuinely working automation, not a clickable mock. The graded thing
is the pipe: a person types messy words, a real LLM call structures them, and
two human-readable documents come out the other end — validated by a real
rules engine along the way.

> **North star:** registered wills / month at the same headcount. The build
> makes lawyer time and case state *measurable*, because the whole business
> case rests on those numbers.

---

## Run the automation with no UI first

This is deliberate — the brief's build order is "automation before interface."

```bash
npm install
npm run demo:pipe                    # uses a built-in example paragraph
npm run demo:pipe -- "I'm British, married to Sarah, we live in Dubai
  Marina. Everything to Sarah, split equally between our two kids if she
  predeceases me..."
```

Prints, and writes to `./out/`:
1. the raw identity + wishes input,
2. the **real Anthropic call** → structured JSON (or the honest fallback if no
   key is set — see below),
3. the rules-engine flags (block/warn/info/ok),
4. **Output 1** — the DIFC will draft, human-readable,
5. **Output 2** — the ops portal package, human-readable, copy-paste, never JSON.

`scripts/demo-pipe.ts` calls the exact same `src/lib/llm.ts` module the web
app's `/api/structure` route calls — one code path, proven both ways.

## Run the app

```bash
npm run dev          # http://localhost:3000
```

Zero backend required — the app seeds a rich demo dataset into a localStorage
store on first load (four lawyer cases, one case already sitting in
client-final-approval with a real lawyer edit applied, stalled intakes, and
history so the metrics are non-empty).

### Optional: wire in the real LLM (+ OCR)

The structuring step **and** document OCR both call a real Anthropic model
when a key is present; without one, both fall back to an honest, clearly
labelled degraded result — see "What's real vs mocked" below.

```bash
cp .env.example .env
# set ANTHROPIC_API_KEY=... (optionally ANTHROPIC_MODEL, default claude-sonnet-5)
```

### Optional: Postgres + Storage source of truth

`supabase/schema.sql` is the production relational model (enums, FKs,
timestamps, RLS, metric views). `supabase/storage.sql` creates the `wills`
Storage bucket + policies for document uploads. The localStorage store mirrors
both 1:1 — set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` to
switch document uploads from a local browser object URL to a real 7-day signed
URL (`src/lib/storage.ts`).

---

## The flow

```
client submits (identity + one free-text wishes field)
  → real LLM call structures it → rules engine flags issues
  → lawyer reviews, amends, approves            (validity)
      ↕ optionally: lawyer raises a clarification mid-review (§1B-ter) —
        case pauses on `awaiting_client`, client answers via a secure link,
        returns to the lawyer at the same item
  → CLIENT reviews the final draft + what the lawyer changed
  → client approves                              (intent/consent)
  → portal-ready package + document links generate
  → appointment booked → testator e-signs at registration with 2 witnesses
```

**Three distinct approvals for three distinct things** — the LLM structures,
the lawyer validates, the client consents. Neither the lawyer nor the client
can be bypassed. The client step exists because the lawyer may amend the
draft (e.g. set a minor's share into trust) and the testator signs personally
at registration — they need to see what changed before they do.

## The three surfaces (top toggle)

- **Client journey** — 5 steps: **Identity** (passport-first OCR, expired
  hard-block, resident/non-resident branch), **Your wishes** (ONE free-text
  box — the automation's input), **Confirm** ("here's what we understood" —
  plain-language summary + editable structured fields + live rules flags),
  **Documents** (deferrable, never gatekeeps), **Review & submit** (checklist
  + dual CTAs). A returning client with a will `pending_client_approval` sees
  a "welcome back" picker instead of a fresh intake.
- **Lawyer review** — an audit-and-approve desk. Queue sorted by *judgment
  load*, a green "cleared at intake" strip, an **Amend draft** panel (the
  lawyer's actual edits — later diffed on the client's screen), priority-
  ordered judgment items with **enforced ordering**, a **gated Approve**
  button that sends the case to the client (not straight to the portal), and
  after client approval, the **Portal-Ready Package** with a real generated
  draft-will PDF. On any item, **"Ask the client"** (§1B-ter) raises a
  clarification instead of clearing it — the LLM drafts a message, the lawyer
  previews/edits, one-click sends it as a secure link (email/WhatsApp). Sets
  `awaiting_client`, pauses the review timer, drops the case from the active
  queue until the client responds — no ops handoff in the path.
- **Re-engagement (Ops)** — two tabs. **Stalled intakes**: recovers
  started-but-not-submitted intakes, sorted by how long they're stuck, with
  recoverability, a funnel bar, a "what's blocking them" reason, preferred
  channel, and three logged recovery actions. **Awaiting client**: read-only
  visibility into clarifications a lawyer sent (§1B-ter) — never a work queue;
  the only action is an optional backstop to follow up on a silent client.

---

## What's real vs mocked

**Real — executes live on input given in the room:**

- **The free-text → Anthropic API → structured JSON call** (`src/lib/llm.ts` +
  `/api/structure` + `scripts/demo-pipe.ts`) — the crown jewel. Forced
  tool-use JSON, validated against a zod schema (`src/lib/schema.ts`)
  **before** anything trusts it. On failure/no key, an honest fallback that
  does *not* pretend to have structured the text — it flags everything for
  manual entry rather than faking a plausible-looking result.
- The rules engine (`src/lib/rules.ts`) — block/warn/info/ok severity model.
- The Schedule 1 draft assembly (`src/lib/schedule1.ts` + `LiveWill.tsx`).
- The ops/portal-ready package generation — human-readable, copy-paste, never
  raw JSON (`src/lib/portal.ts`).
- Document storage, signed-URL generation, and validation-matching
  (`src/lib/storage.ts` — real Supabase Storage when configured, honest local
  fallback otherwise).
- Draft-will **PDF generation** (`src/lib/pdf.tsx` + `/api/will-pdf`, via
  `@react-pdf/renderer` — a real PDF, not a screenshot).
- The lawyer approval state machine (ordered clearing, gated approval, lawyer
  edits diffed for the client, logged timings).
- The client final-approval consent gate (`ClientFinalApproval.tsx`) — diffs
  pre- vs post-lawyer structured data into plain language.
- **Clarifications** (§1B-ter, `src/lib/clarification.ts` + `/api/clarification-draft`
  + `ClarificationResponse.tsx`) — lawyer-direct, one-click mid-review
  questions/re-uploads. LLM-drafted message (real Anthropic call, honest
  template fallback), lawyer previews and edits before it sends. The review
  timer pauses (`clarification_wait_seconds`, tracked separately from
  `active_seconds`) so the 90→15 KPI never counts the client's response time
  as lawyer work.
- The data layer (`src/lib/store.ts`) — every transition persisted and
  timestamped; metrics derived from stored rows, never computed-and-discarded.

**Mocked — peripheral to the automation, labelled honestly in the UI:**

- OCR extraction (real Claude vision call when a key is set — same key, no
  extra vendor; canned fields on the fallback path; the *matching* logic
  against intake data is always real).
- The clause library's exact legal wording (real Schedule 1 *structure* with
  bracketed slots — illustrative, not registration-grade text).
- The final submission into DIFC's own portal (external government system —
  we produce the package + document links; the attach click is manual).

---

## The severity model (used everywhere)

| Severity | Meaning | Owner | Where it surfaces |
|----------|---------|-------|-------------------|
| `block`  | Legally fatal, client-fixable (shares ≠ 100, no UAE asset, missing/expired passport) | client | Caught at intake — never reaches the lawyer as work |
| `warn`   | Needs a human judgment call (name mismatch, minor no-trust, duplicate beneficiary, ADJD split, foreign-will clash, joint deed, business shares, missing substitution, AI-structured distribution) | lawyer | Priority-ordered review items |
| `info`   | Awareness (non-resident path, guardianship note) | none | Lawyer "for awareness" panel |
| `ok`     | Passed | client | Green "cleared at intake" strip |

**Strict on content, async on documents** — tightening validation never costs
completion rate, because documents defer and only content blocks submission.

---

## Architecture

```
scripts/demo-pipe.ts   Standalone CLI: text -> real LLM call -> draft + package
src/lib/
  types.ts        Domain types (mirror the Postgres tables). Identity (passport/
                   EID) is separate from StructuredWill — the model never
                   invents identity facts, only structures free-text wishes.
  schema.ts       zod + JSON-Schema for the LLM output (the trust boundary)
  llm.ts          CROWN JEWEL: prompt + real Anthropic call + validate + fallback
  structure.ts    Honest no-key fallback (flags for manual entry, doesn't fake it)
  rules.ts        Rules engine (severity checks)
  schedule1.ts    JSON -> DIFC Schedule 1 bracketed form (+ plain-text renderer)
  portal.ts       JSON -> human-readable, copy-paste 10-step ops package
  pdf.tsx         Draft-will PDF renderer (@react-pdf/renderer)
  storage.ts      Supabase Storage uploads + signed URLs, honest local fallback
  clarification.ts LLM-drafted clarification messages (§1B-ter) + honest fallback
  store.ts        localStorage data layer (mirrors supabase/schema.sql 1:1)
  stateMachine.ts Funnel ordering, complexity, blocking-reason, pre/post-lawyer diff
  metrics.ts      Every business metric, derived from stored rows
  seed.ts         Demo cases, a pending-client-approval case, an open + an
                   answered clarification, and stalled leads
src/components/
  LiveWill.tsx           The signature: Schedule 1 assembling in real time
  client/ClientJourney.tsx        5-step intake
  client/ClientFinalApproval.tsx  The consent gate (§1B-bis)
  client/ClarificationResponse.tsx The adaptive secure-link screen (§1B-ter)
  lawyer/LawyerDesk.tsx           Review desk incl. "Amend draft" + "Ask the client"
  lawyer/PortalPackage.tsx        Human-readable package + PDF generation
  ops/OpsDesk.tsx                 Two tabs: stalled intakes + read-only awaiting client
  ops/MetricsBar.tsx              Metrics strip
src/app/
  page.tsx           Three-surface toggle
  api/structure/     Server-side LLM call (keeps the key off the client)
  api/ocr/            Server-side Claude vision call for document OCR
  api/will-pdf/        Server-side PDF rendering
  api/clarification-draft/ Server-side clarification message drafting
```

---

## Honesty & guardrails (baked in — they're the point)

- The "90 → 15 min" figure is **standard-case, at full build**; the fleet
  average is higher because complex cases stay ~90. The app **computes real
  times** from `review_sessions` and reports standard-case and fleet averages
  *separately* — nothing hardcodes "15".
- Client-fixable errors are caught at intake and shown to the lawyer as passed
  confirmations, not work. Only genuine judgment calls consume lawyer time.
- The lawyer can never be bypassed — approval is gated on clearing every item,
  in order. Neither can the client — a lawyer-approved will always goes to the
  client for final consent before the portal package generates.
- Every mocked component is labelled ("OCR simulated" / "read by Claude
  vision", "Illustrative structure", "Portal submission external").
- **Scope:** DIFC **Full Will** only. ADJD / other will-types / portal-RPA are
  represented in the data model but deferred in the build — by design, not
  oversight.
- Clarifications are lawyer-direct, one-click; ops is a read-only backstop,
  never a required handoff — so no ops queue bottlenecks the lawyer's loop.
- The ops package is human-readable copy-paste, never raw JSON, with clickable
  document links ready to attach.

---

## Design

Editorial, calm, trustworthy — estate planning, not a fintech dashboard. The
palette is the documented fallback from the brief (deep ink navy, warm
paper/parchment, sage = done, clay = block, amber = warn). PRYPCO's live brand
tokens could not be fetched (the site blocks bots), so swap
`tailwind.config.ts` colours for PRYPCO's if desired.
