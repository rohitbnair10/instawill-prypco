# InstaWill

Assisted drafting for **DIFC (Dubai International Financial Centre) non-Muslim wills.**
Real intake → LLM-structured draft → rules-engine validation → lawyer audit-and-approve.

This is a genuinely working prototype, not a clickable mock. A real person can type
real answers and watch a validated, structured DIFC Schedule 1 will assemble in real
time — with the lawyer's judgment gate intact.

> **North star:** registered wills / month at the same headcount. The build makes
> lawyer time and case state *measurable*, because the whole business case rests on
> those numbers.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Zero backend required — the app seeds a rich demo dataset into a localStorage store
on first load (four lawyer cases, stalled intakes, and history so the metrics are
non-empty).

### Optional: wire in the real LLM

The structuring step calls a **real Anthropic model** when a key is present; without
one it uses a deterministic fallback and honestly labels the result. Both paths cross
the same validate-before-trust boundary.

```bash
cp .env.example .env
# set ANTHROPIC_API_KEY=... (optionally ANTHROPIC_MODEL, default claude-sonnet-5)
```

### Optional: Postgres source of truth

`supabase/schema.sql` is the production relational model (enums, FKs, timestamps,
RLS, metric views). The localStorage store mirrors it 1:1. `supabase/seed.sql`
seeds staff users.

---

## The three surfaces (top toggle)

- **Client journey** — a 7-step intake with a two-panel layout: questions left, the
  DIFC Schedule 1 will assembling live on the right. Passport-first (simulated OCR
  fills the form), expired-passport hard block, resident vs non-resident paths,
  guardian logic, ADJD warning for Abu Dhabi property, live 100%-share counter,
  minor-without-trust flag, foreign-will and substitution safety questions,
  deferrable documents that never gatekeep, and a review checklist with dual CTAs.
- **Lawyer review** — an audit-and-approve desk. Queue sorted by *judgment load*, a
  green "cleared at intake" strip (client-fixable checks that passed, for the
  liability record), priority-ordered judgment items with **enforced ordering**
  (each locked until the one above is cleared), a **gated Approve** button, the live
  document alongside, and the **Portal-Ready Package** (10-step DIFC handoff) after
  approval. The human can never be bypassed.
- **Re-engagement (Ops)** — recovers started-but-not-submitted intakes, sorted by
  how long they're stuck, with recoverability, a funnel bar, a "what's blocking
  them" reason, preferred channel, and three logged recovery actions.

---

## What's real vs mocked

**Real (actually works):**

- The full intake flow and all client-side validation (share math, minor detection,
  UAE-asset requirement, foreign-will / ADJD / business flags).
- **The LLM structuring step** (`src/lib/llm.ts` + `/api/structure`) — the crown
  jewel. Client answers → strict JSON matching a zod schema (`src/lib/schema.ts`),
  via a forced Anthropic tool call. **Validated before trusted**; on malformed output
  it's flagged "AI-structured — verify" for the lawyer rather than trusted blind.
- The rules engine (`src/lib/rules.ts`) running the severity model on structured JSON.
- The Schedule 1 template fill (`src/lib/schedule1.ts`) — JSON → the bracketed form.
- The lawyer approval state machine (ordered clearing, gated approval, logged
  transitions with real start/end timestamps).
- The data layer (`src/lib/store.ts`) — every state transition persisted and
  timestamped; metrics derived from stored rows, never computed-and-discarded.

**Mocked (labelled honestly in the UI):**

- OCR extraction (returns canned structured fields; the *matching* logic is real).
- The clause library's exact legal wording (real Schedule 1 *structure* with
  bracketed slots — illustrative, not registration-grade text).
- DIFC portal submission (external system — we build the portal-ready package).

---

## The severity model (used everywhere)

| Severity | Meaning | Owner | Where it surfaces |
|----------|---------|-------|-------------------|
| `block`  | Legally fatal, client-fixable (shares ≠ 100, no UAE asset, missing/expired passport) | client | Caught at intake — never reaches the lawyer as work |
| `warn`   | Needs a human judgment call (name mismatch, minor no-trust, ADJD split, foreign-will clash, joint deed, business shares, AI-structured distribution) | lawyer | Priority-ordered review items |
| `info`   | Awareness (non-resident path, guardianship note) | none | Lawyer "for awareness" panel |
| `ok`     | Passed | client | Green "cleared at intake" strip |

**Strict on content, async on documents** — tightening validation never costs
completion rate, because documents defer and only content blocks submission.

---

## Architecture

```
src/lib/
  types.ts        Domain types (mirror the Postgres tables)
  schema.ts       zod + JSON-Schema for the LLM output (the trust boundary)
  llm.ts          CROWN JEWEL: prompt + real Anthropic call + validate + fallback
  structure.ts    Pure client-safe structurer (live preview + fallback)
  rules.ts        Rules engine (severity checks)
  schedule1.ts    JSON → DIFC Schedule 1 bracketed form
  store.ts        localStorage data layer (mirrors supabase/schema.sql 1:1)
  stateMachine.ts Funnel ordering, complexity, blocking-reason logic
  portal.ts       DIFC 10-step portal package builder
  metrics.ts      Every business metric, derived from stored rows
  seed.ts         Demo cases (Sarah, Menon, Okoro, Voss) + stalled leads + history
src/components/
  LiveWill.tsx    The signature: Schedule 1 assembling in real time
  client/         7-step intake
  lawyer/         Review desk + Portal-Ready Package
  ops/            Re-engagement desk + metrics bar
src/app/
  page.tsx        Three-surface toggle
  api/structure/  Server-side LLM call (keeps the key off the client)
```

---

## Honesty & guardrails (baked in — they're the point)

- The "90 → 15 min" figure is **standard-case, at full build**; the fleet average is
  higher because complex cases stay ~90. The app **computes real times** from
  `review_sessions` and reports standard-case and fleet averages *separately* —
  nothing hardcodes "15".
- Client-fixable errors are caught at intake and shown to the lawyer as passed
  confirmations, not work. Only genuine judgment calls consume lawyer time.
- The lawyer can never be bypassed — approval is gated on clearing every item, in
  order.
- Every mocked component is labelled ("OCR simulated", "Illustrative structure",
  "Portal submission external").
- **Scope:** DIFC **Full Will** only. ADJD / other will-types / portal-RPA are
  represented in the data model but deferred in the build — by design, not oversight.

---

## Design

Editorial, calm, trustworthy — estate planning, not a fintech dashboard. The palette
is the documented fallback from the brief (deep ink navy, warm paper/parchment, sage
= done, clay = block, amber = warn). PRYPCO's live brand tokens could not be fetched
(the site blocks bots), so swap `tailwind.config.ts` colours for PRYPCO's if desired.
